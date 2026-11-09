import { findErrorCode, INSERT_CHUNK_SIZE, isRejectedRowCode } from "@studyrooms/db";
import type { DiskQueue } from "./event-queue.ts";
import { botMarker, toQueuedEvent, type QueuedEvent, type RawEventInput } from "./raw-event.ts";

/** Sinal do bot (D-19): sem eventos, é o único acesso ao banco, para o Neon poder suspender. */
export const HEARTBEAT_MS = 30 * 60_000;
/** Espera entre tentativas com o banco fora; a última se repete enquanto ele não voltar. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const;

export type EventWriterDeps = {
  queue: DiskQueue;
  /** Grava os eventos e devolve quantos eram novos. Repetir um evento já gravado não o duplica. */
  insert(events: QueuedEvent[]): Promise<number>;
  log(line: string): void;
  now(): Date;
  newKey(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Só para testes com banco real, que não podem esperar minutos. */
  retryDelaysMs?: readonly number[];
};

export type EventWriter = {
  /** Guarda o evento na fila em disco e agenda a gravação no banco. Nunca lança. */
  record(event: RawEventInput): void;
  /** Liga o sinal de 30 min e grava o que tiver ficado na fila de uma execução anterior. */
  start(): void;
  /** Última tentativa de gravar a fila, sem log e sem novas tentativas. O que falhar fica no disco. */
  close(): Promise<void>;
  readonly accesses: number;
};

/**
 * Leva os eventos da fila em disco para o banco, na ordem em que foram observados.
 *
 * - Com o banco fora, tenta de novo com espera crescente; evento novo não antecipa a tentativa.
 * - Linha recusada pelo banco (SQLSTATE das classes 22 e 23) vai para a quarentena: o lote é
 *   refeito um a um, e só a linha recusada sai da fila sem ser gravada.
 * - O log mostra só o código do erro, nunca a mensagem: a do Drizzle e a do pg trazem os
 *   parâmetros, com IDs do Discord. Cada acesso ao banco é numerado, para estimar as horas do Neon.
 */
export function createEventWriter(deps: EventWriterDeps): EventWriter {
  const { queue } = deps;
  const retryDelays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  let accesses = 0;
  let closed = false;
  let flushing: Promise<void> | null = null;
  let flushTimer: unknown = null;
  let retryTimer: unknown = null;
  let heartbeatTimer: unknown = null;
  let retryIndex = 0;
  // Depois de um lote recusado, os próximos N eventos vão um a um, para achar a linha recusada.
  let isolating = 0;

  function log(line: string): void {
    if (!closed) deps.log(line);
  }

  function prefix(): string {
    return `[db] ${deps.now().toISOString()} acesso=${accesses}`;
  }

  function scheduleFlush(): void {
    if (closed || flushTimer !== null || retryTimer !== null) return;
    flushTimer = deps.setTimer(() => {
      flushTimer = null;
      void flush();
    }, 0);
  }

  /** Agenda a próxima tentativa com espera crescente; `describe` monta a linha de log com a espera. */
  function scheduleRetry(describe: (seconds: number) => string): void {
    if (closed) return;
    const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)]!;
    retryIndex += 1;
    log(describe(delay / 1000));
    retryTimer = deps.setTimer(() => {
      retryTimer = null;
      void flush();
    }, delay);
  }

  function flush(): Promise<void> {
    if (!flushing) {
      const current = drain().then(
        () => {},
        // `drain` só lança se a própria fila em disco falhar (por exemplo, disco cheio). A fila
        // não muda quando a regravação falha, então reenviar o lote é seguro (idempotente).
        (error: unknown) => {
          const code = findErrorCode(error) ?? "desconhecido";
          scheduleRetry((s) => `[fila] erro ao atualizar a fila em disco (código: ${code}); nova tentativa em ${s} s`);
        },
      );
      flushing = current.finally(() => {
        flushing = null;
      });
    }
    return flushing;
  }

  /**
   * Devolve `false` se parou por falha de ambiente (banco fora), com a fila intacta. Falha da fila
   * em disco não é falha do banco: ela sai do `try` do insert e é tratada em `flush`.
   */
  async function drain(retry = true): Promise<boolean> {
    while (queue.size > 0) {
      const batch = queue.peek(isolating > 0 ? 1 : INSERT_CHUNK_SIZE);
      accesses += 1;
      let inserted: number;
      try {
        inserted = await deps.insert(batch);
      } catch (error) {
        const code = findErrorCode(error);
        if (!isRejectedRowCode(code)) {
          const access = prefix();
          if (retry) {
            scheduleRetry(
              (s) => `${access} falhou (código: ${code ?? "desconhecido"}); pendentes=${queue.size}; nova tentativa em ${s} s`,
            );
          }
          return false;
        }
        if (batch.length > 1) {
          isolating = batch.length;
          continue;
        }
        queue.quarantineFirst(code);
        if (isolating > 0) isolating -= 1;
        log(`${prefix()} evento recusado pelo banco (código: ${code}); separado em quarentena; pendentes=${queue.size}`);
        continue;
      }
      queue.drop(batch.length);
      if (isolating > 0) isolating -= 1;
      retryIndex = 0;
      const reason = batch.every((e) => e.eventType === "bot_heartbeat") ? "sinal" : "eventos";
      log(`${prefix()} motivo=${reason} gravados=${batch.length} novos=${inserted} pendentes=${queue.size}`);
    }
    return true;
  }

  function armHeartbeat(): void {
    heartbeatTimer = deps.setTimer(() => {
      if (closed) return;
      armHeartbeat();
      record(botMarker("bot_heartbeat", deps.now()));
    }, HEARTBEAT_MS);
  }

  function record(event: RawEventInput): void {
    if (closed) return;
    try {
      queue.append(toQueuedEvent(event, deps.newKey()));
    } catch (error) {
      // Sem a fila, o evento se perde; o bot segue para não perder também os próximos.
      deps.log(`[fila] erro: evento não guardado na fila em disco (código: ${findErrorCode(error) ?? "desconhecido"}).`);
      return;
    }
    scheduleFlush();
  }

  return {
    record,
    start() {
      if (closed || heartbeatTimer !== null) return;
      armHeartbeat();
      if (queue.size > 0) scheduleFlush();
    },
    async close() {
      if (closed) return;
      // `record` de último instante (o bot_stop) entra antes de fechar.
      for (const timer of [flushTimer, retryTimer, heartbeatTimer]) {
        if (timer !== null) deps.clearTimer(timer);
      }
      flushTimer = retryTimer = heartbeatTimer = null;
      closed = true;
      if (flushing) await flushing;
      // Disco cheio aqui não impede o encerramento: o que não saiu da fila é reenviado na volta.
      await drain(false).catch(() => {});
    },
    get accesses() {
      return accesses;
    },
  };
}
