import {
  closeSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { parseQueuedEvent, type QueuedEvent } from "./raw-event.ts";

export const PENDING_FILE = "pending.jsonl";
export const QUARANTINE_FILE = "quarantine.jsonl";

/** Mesma assinatura do `fs.writeSync` com buffer; os testes injetam um disco cheio ou writes curtos. */
export type WriteFn = (fd: number, buffer: Uint8Array, offset: number, length: number) => number;

/**
 * Grava todos os bytes ou lança. Com o disco quase cheio, o Linux faz write curto (grava parte e
 * não lança); aqui o restante é pedido de novo, e um write de 0 bytes vira ENOSPC.
 */
function writeAll(write: WriteFn, fd: number, text: string): void {
  const buffer = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    const written = write(fd, buffer, offset, buffer.length - offset);
    if (written <= 0) {
      throw Object.assign(new Error("escrita incompleta na fila em disco"), { code: "ENOSPC" });
    }
    offset += written;
  }
}

/**
 * Acrescenta texto e só volta depois de o sistema confirmar a escrita no disco. Se falhar no meio,
 * desfaz o pedaço gravado: uma linha cortada colaria no próximo evento e corromperia os dois.
 */
function appendDurably(write: WriteFn, path: string, text: string): void {
  const fd = openSync(path, "a");
  // Sem o tamanho anterior, não há como desfazer com segurança (truncar em 0 apagaria a fila).
  let sizeBefore: number | null = null;
  try {
    sizeBefore = fstatSync(fd).size;
    writeAll(write, fd, text);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    // Pelo caminho, com o arquivo já fechado: no Windows, o descritor em modo append não trunca.
    try {
      if (sizeBefore !== null) truncateSync(path, sizeBefore);
    } catch {
      // Se nem desfazer der certo, a linha cortada vai para a quarentena ao reabrir a fila.
    }
    throw error;
  }
  closeSync(fd);
}

/**
 * Substitui o arquivo de uma vez: quem ler depois vê o conteúdo antigo inteiro ou o novo inteiro.
 * O temporário só é renomeado depois de gravado por completo e sincronizado; se falhar, é apagado
 * e o arquivo antigo fica como estava.
 */
function replaceDurably(write: WriteFn, dir: string, path: string, text: string): void {
  const tmp = `${path}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeAll(write, fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  renameSync(tmp, path);
  // No Linux, o rename só fica durável com o fsync da pasta. No Windows, abrir pasta falha; lá o
  // rename já é registrado pelo NTFS.
  try {
    const dirFd = openSync(dir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Sem fsync da pasta, uma queda de energia pode trazer a fila anterior: o reenvio é idempotente.
  }
}

export type DiskQueueOptions = { write?: WriteFn };

function serialize(events: readonly QueuedEvent[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

export type OpenResult = {
  queue: DiskQueue;
  loaded: number;
  damaged: number;
  /**
   * Código do erro se as linhas ilegíveis não couberam na quarentena (disco cheio). Nesse caso,
   * elas continuam na fila e vão para a quarentena na próxima regravação ou abertura.
   */
  quarantineError: string | null;
};

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "desconhecido";
}

/**
 * Fila de eventos ainda não gravados no banco, num arquivo JSON por linha.
 *
 * - Cada evento é escrito e sincronizado no disco antes de seguir: matar o processo não o perde.
 * - Só sai da fila depois que o banco confirmou a gravação. Se o processo morrer entre a
 *   confirmação e a remoção, o evento é reenviado, e a chave de idempotência evita a duplicata.
 * - Linha ilegível (escrita cortada por uma queda) ou recusada pelo banco vai para a quarentena,
 *   para não travar as outras. A quarentena contém IDs do Discord: não a imprima em log.
 *
 * Todas as operações de arquivo são síncronas: no Node, nada roda no meio delas, então uma
 * gravação nova nunca se perde numa regravação da fila.
 */
export class DiskQueue {
  readonly #dir: string;
  readonly #pendingPath: string;
  readonly #quarantinePath: string;
  readonly #write: WriteFn;
  #events: QueuedEvent[];
  /** Linhas ilegíveis que ainda não couberam na quarentena; seguem no início da fila em disco. */
  #damaged: string[] = [];

  private constructor(dir: string, events: QueuedEvent[], write: WriteFn) {
    this.#dir = dir;
    this.#write = write;
    this.#pendingPath = join(dir, PENDING_FILE);
    this.#quarantinePath = join(dir, QUARANTINE_FILE);
    this.#events = events;
  }

  static open(dir: string, options: DiskQueueOptions = {}): OpenResult {
    mkdirSync(dir, { recursive: true });
    const pendingPath = join(dir, PENDING_FILE);
    rmSync(`${pendingPath}.tmp`, { force: true });
    let text = "";
    try {
      text = readFileSync(pendingPath, "utf8");
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") throw error;
    }

    const events: QueuedEvent[] = [];
    const damagedLines: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.trim() === "") continue;
      let parsed: QueuedEvent | null = null;
      try {
        parsed = parseQueuedEvent(JSON.parse(line));
      } catch {
        parsed = null;
      }
      if (parsed) events.push(parsed);
      else damagedLines.push(line);
    }

    const queue = new DiskQueue(dir, events, options.write ?? writeSync);
    let quarantineError: string | null = null;
    if (damagedLines.length > 0) {
      // Disco cheio aqui não impede a subida: o bot segue, e a fila em disco fica como estava.
      queue.#damaged = damagedLines;
      try {
        queue.#quarantineDamaged();
      } catch (error) {
        quarantineError = errorCode(error);
      }
      if (quarantineError === null) {
        try {
          queue.#persist(events);
        } catch {
          // As linhas já estão na quarentena; a próxima regravação as tira da fila.
        }
      }
    }
    return { queue, loaded: events.length, damaged: damagedLines.length, quarantineError };
  }

  get size(): number {
    return this.#events.length;
  }

  append(event: QueuedEvent): void {
    appendDurably(this.#write, this.#pendingPath, serialize([event]));
    this.#events.push(event);
  }

  peek(limit: number): QueuedEvent[] {
    return this.#events.slice(0, limit);
  }

  /**
   * Remove os `count` primeiros, depois que o banco confirmou a gravação deles. Grava o disco
   * antes de mudar a memória: se lançar, os dois continuam iguais e o lote pode ser reenviado.
   */
  drop(count: number): void {
    if (count <= 0) return;
    const remaining = this.#events.slice(count);
    this.#persist(remaining);
    this.#events = remaining;
  }

  /** Separa o primeiro evento, recusado pelo banco, guardando só o código do erro. */
  quarantineFirst(code: string | undefined): void {
    const [first] = this.#events;
    if (!first) return;
    const at = new Date().toISOString();
    appendDurably(
      this.#write,
      this.#quarantinePath,
      `${JSON.stringify({ reason: "recusado_pelo_banco", code: code ?? null, at, event: first })}\n`,
    );
    this.drop(1);
  }

  /** Move as linhas ilegíveis pendentes para a quarentena. Lança se o disco não aceitar. */
  #quarantineDamaged(): void {
    if (this.#damaged.length === 0) return;
    const at = new Date().toISOString();
    appendDurably(
      this.#write,
      this.#quarantinePath,
      this.#damaged.map((line) => `${JSON.stringify({ reason: "linha_ilegivel", at, line })}
`).join(""),
    );
    this.#damaged = [];
  }

  #persist(events: readonly QueuedEvent[]): void {
    try {
      this.#quarantineDamaged();
    } catch {
      // Sem espaço para a quarentena, as linhas ilegíveis continuam no início da fila.
    }
    const damaged = this.#damaged.map((line) => `${line}
`).join("");
    replaceDurably(this.#write, this.#dir, this.#pendingPath, damaged + serialize(events));
  }
}
