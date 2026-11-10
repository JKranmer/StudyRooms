/**
 * Códigos de saída e nova tentativa de login. Na VM, o systemd reinicia o bot quando ele sai com
 * erro, exceto com EXIT_CONFIG (veja deploy/systemd): reiniciar não conserta token, allowlist ou
 * permissão errados, e só geraria um laço.
 */
export const EXIT_FAILURE = 1;
/** EX_CONFIG, de sysexits.h: erro de configuração. */
export const EXIT_CONFIG = 78;

/** Espera entre tentativas de login com a rede fora; a última se repete enquanto ela não voltar. */
export const LOGIN_RETRY_DELAYS_MS = [5_000, 10_000, 30_000, 60_000, 120_000, 300_000] as const;

export type LoginFailure = { kind: "config" | "transient" | "fatal"; code: string };

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "EPIPE",
  "ABORT_ERR",
]);
const CODE = /^[A-Za-z0-9_]{2,32}$/;

/** Código de rede ou do discord.js, procurado também em `cause` (o fetch do undici o põe lá). */
function findCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && CODE.test(code)) return code;
    current = cause;
  }
  return undefined;
}

/** Só códigos, status e nomes curtos: a mensagem do erro pode trazer dados sensíveis. */
export function classifyLoginError(error: unknown): LoginFailure {
  const { status, name } = (error && typeof error === "object" ? error : {}) as { status?: unknown; name?: unknown };
  const code = findCode(error);
  if (code === "TokenInvalid") return { kind: "config", code };
  if (typeof status === "number") {
    const httpCode = `HTTP_${status}`;
    if (status === 401) return { kind: "config", code: httpCode };
    if (status === 429 || status >= 500) return { kind: "transient", code: httpCode };
    return { kind: "fatal", code: httpCode };
  }
  if (code && (NETWORK_CODES.has(code) || code.startsWith("UND_ERR_"))) return { kind: "transient", code };
  if (name === "AbortError") return { kind: "transient", code: name };
  if (code) return { kind: "fatal", code };
  if (typeof name === "string" && CODE.test(name)) return { kind: "fatal", code: name };
  return { kind: "fatal", code: "desconhecido" };
}

/** 4004: token recusado; 4013 e 4014: intents inválidas ou não liberadas no portal. */
const CONFIG_CLOSE_CODES = new Set([4004, 4013, 4014]);

export function gatewayCloseExitCode(code: number): number {
  return CONFIG_CLOSE_CODES.has(code) ? EXIT_CONFIG : EXIT_FAILURE;
}

/** Pasta da fila sem permissão ou inválida não se conserta reiniciando; disco cheio pode passar. */
const CONFIG_QUEUE_CODES = new Set(["EACCES", "EPERM", "EROFS", "ENOTDIR"]);

export function queueOpenExitCode(code: string | undefined): number {
  return code !== undefined && CONFIG_QUEUE_CODES.has(code) ? EXIT_CONFIG : EXIT_FAILURE;
}

export type LoginOutcome =
  | { status: "connected" }
  | { status: "failed"; exitCode: number }
  | { status: "cancelled" };

export type LoginLoopDeps = {
  /** Uma tentativa de login, numerada a partir de 1. Cada uma deve usar um cliente novo. */
  attempt(n: number): Promise<void>;
  log(line: string): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  delaysMs?: readonly number[];
};

export type LoginLoop = {
  /** Tenta até conectar, até um erro que não se resolve tentando de novo, ou até `cancel`. */
  run(): Promise<LoginOutcome>;
  /** Para de tentar (encerramento): a espera é cancelada, e nada mais é logado. */
  cancel(): void;
};

/**
 * Com erro de rede no login (sem internet depois do reboot, DNS fora, Discord instável), o bot
 * espera e tenta de novo, dentro do processo, em vez de sair: assim, quem o supervisiona não
 * precisa reiniciá-lo, e não há laço de reinícios.
 */
export function createLoginLoop(deps: LoginLoopDeps): LoginLoop {
  const delays = deps.delaysMs ?? LOGIN_RETRY_DELAYS_MS;
  let cancelled = false;
  let timer: unknown = null;
  let wake: (() => void) | null = null;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = deps.setTimer(() => {
        timer = null;
        wake = null;
        resolve();
      }, ms);
    });

  return {
    async run() {
      for (let n = 1; ; n++) {
        if (cancelled) return { status: "cancelled" };
        try {
          await deps.attempt(n);
        } catch (error) {
          if (cancelled) return { status: "cancelled" };
          const failure = classifyLoginError(error);
          if (failure.kind === "config") {
            deps.log(
              failure.code === "TokenInvalid" || failure.code === "HTTP_401"
                ? "[bot] erro: DISCORD_BOT_TOKEN inválido: o Discord recusou o login. Gere outro token no portal."
                : `[bot] erro: configuração recusada pelo Discord (código: ${failure.code}).`,
            );
            return { status: "failed", exitCode: EXIT_CONFIG };
          }
          if (failure.kind === "fatal") {
            deps.log(`[bot] erro: não foi possível conectar ao Discord (código: ${failure.code}).`);
            return { status: "failed", exitCode: EXIT_FAILURE };
          }
          const delay = delays[Math.min(n - 1, delays.length - 1)]!;
          deps.log(
            `[bot] aviso: não foi possível conectar ao Discord (código: ${failure.code}); tentativa ${n}; nova tentativa em ${delay / 1000} s.`,
          );
          await wait(delay);
          continue;
        }
        if (cancelled) return { status: "cancelled" };
        if (n > 1) deps.log(`[bot] conectado ao Discord na tentativa ${n}.`);
        return { status: "connected" };
      }
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      const resolve = wake;
      wake = null;
      resolve?.();
    },
  };
}
