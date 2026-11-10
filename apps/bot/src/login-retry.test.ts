import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyLoginError,
  createLoginLoop,
  EXIT_CONFIG,
  EXIT_FAILURE,
  gatewayCloseExitCode,
  LOGIN_RETRY_DELAYS_MS,
  queueOpenExitCode,
} from "./login-retry.ts";

test("código de configuração é 78 (EX_CONFIG), diferente da falha genérica", () => {
  assert.equal(EXIT_CONFIG, 78);
  assert.equal(EXIT_FAILURE, 1);
});

test("token recusado é erro de configuração", () => {
  const error = Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" });
  assert.deepEqual(classifyLoginError(error), { kind: "config", code: "TokenInvalid" });
  assert.deepEqual(classifyLoginError({ status: 401, name: "DiscordAPIError[0]" }), { kind: "config", code: "HTTP_401" });
});

test("erros de rede, 5xx, 429 e tempo esgotado são transitórios", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]) {
    assert.deepEqual(classifyLoginError(Object.assign(new Error("x"), { code })), { kind: "transient", code });
  }
  assert.deepEqual(classifyLoginError({ name: "HTTPError", status: 503 }), { kind: "transient", code: "HTTP_503" });
  assert.deepEqual(classifyLoginError({ name: "HTTPError", status: 429 }), { kind: "transient", code: "HTTP_429" });
  assert.deepEqual(classifyLoginError({ name: "AbortError" }), { kind: "transient", code: "AbortError" });
  // fetch do undici: TypeError "fetch failed" com o código de rede em `cause`.
  const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  assert.deepEqual(classifyLoginError(fetchFailed), { kind: "transient", code: "ECONNRESET" });
});

test("outro erro é falha genérica, sem mensagem no código", () => {
  assert.deepEqual(classifyLoginError({ name: "DiscordAPIError[0]", status: 403 }), { kind: "fatal", code: "HTTP_403" });
  assert.deepEqual(classifyLoginError(new Error("SEGREDO")), { kind: "fatal", code: "Error" });
  assert.deepEqual(classifyLoginError(undefined), { kind: "fatal", code: "desconhecido" });
  assert.deepEqual(classifyLoginError({ name: "nome com espaço e SEGREDO" }), { kind: "fatal", code: "desconhecido" });
});

test("códigos de fechamento do gateway: autenticação e intents são configuração; o resto, falha", () => {
  assert.equal(gatewayCloseExitCode(4004), EXIT_CONFIG);
  assert.equal(gatewayCloseExitCode(4013), EXIT_CONFIG);
  assert.equal(gatewayCloseExitCode(4014), EXIT_CONFIG);
  assert.equal(gatewayCloseExitCode(4010), EXIT_FAILURE);
  assert.equal(gatewayCloseExitCode(4011), EXIT_FAILURE);
});

test("fila em disco que não abre por permissão é configuração; o resto, falha", () => {
  for (const code of ["EACCES", "EPERM", "EROFS", "ENOTDIR"]) assert.equal(queueOpenExitCode(code), EXIT_CONFIG);
  for (const code of ["ENOSPC", "EIO", undefined]) assert.equal(queueOpenExitCode(code), EXIT_FAILURE);
});

test("espera crescente com teto de 5 min", () => {
  assert.deepEqual([...LOGIN_RETRY_DELAYS_MS], [5_000, 10_000, 30_000, 60_000, 120_000, 300_000]);
});

type Timer = { fn: () => void; ms: number; cleared: boolean };

function setup(results: (Error | object | null)[]) {
  const logs: string[] = [];
  const timers: Timer[] = [];
  const attempts: number[] = [];
  const loop = createLoginLoop({
    attempt: async (n) => {
      attempts.push(n);
      const result = results.shift();
      if (result) throw result;
    },
    log: (line) => logs.push(line),
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as Timer).cleared = true;
    },
  });
  return { loop, logs, timers, attempts };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const network = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

test("login de primeira: conecta sem log nem timer", async () => {
  const s = setup([null]);
  assert.deepEqual(await s.loop.run(), { status: "connected" });
  assert.deepEqual(s.logs, []);
  assert.equal(s.timers.length, 0);
});

test("erro de rede: tenta de novo com espera crescente, sem sair, até conectar", async () => {
  const s = setup([network(), network(), network(), null]);
  const outcome = s.loop.run();
  for (const expected of [5_000, 10_000, 30_000]) {
    await tick();
    const timer = s.timers.at(-1)!;
    assert.equal(timer.ms, expected);
    timer.fn();
  }
  assert.deepEqual(await outcome, { status: "connected" });
  assert.deepEqual(s.attempts, [1, 2, 3, 4]);
  assert.deepEqual(s.logs, [
    "[bot] aviso: não foi possível conectar ao Discord (código: ECONNREFUSED); tentativa 1; nova tentativa em 5 s.",
    "[bot] aviso: não foi possível conectar ao Discord (código: ECONNREFUSED); tentativa 2; nova tentativa em 10 s.",
    "[bot] aviso: não foi possível conectar ao Discord (código: ECONNREFUSED); tentativa 3; nova tentativa em 30 s.",
    "[bot] conectado ao Discord na tentativa 4.",
  ]);
});

test("a espera para no teto e se repete enquanto a rede não volta", async () => {
  const s = setup(Array.from({ length: 9 }, network));
  void s.loop.run();
  for (let i = 0; i < 9; i++) {
    await tick();
    s.timers.at(-1)!.fn();
  }
  await tick();
  assert.deepEqual(
    s.timers.map((t) => t.ms),
    [5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000, 300_000],
  );
  s.loop.cancel();
});

test("token inválido: não tenta de novo e devolve o código 78, com mensagem clara", async () => {
  const s = setup([Object.assign(new Error("x"), { code: "TokenInvalid" })]);
  assert.deepEqual(await s.loop.run(), { status: "failed", exitCode: EXIT_CONFIG });
  assert.equal(s.timers.length, 0);
  assert.deepEqual(s.logs, [
    "[bot] erro: DISCORD_BOT_TOKEN inválido: o Discord recusou o login. Gere outro token no portal.",
  ]);
});

test("erro desconhecido depois de falhas de rede: devolve o código 1, sem nova tentativa", async () => {
  const s = setup([network(), { name: "DiscordAPIError[0]", status: 403 }]);
  const outcome = s.loop.run();
  await tick();
  s.timers[0]!.fn();
  assert.deepEqual(await outcome, { status: "failed", exitCode: EXIT_FAILURE });
  assert.equal(s.timers.length, 1);
  assert.equal(s.logs.at(-1), "[bot] erro: não foi possível conectar ao Discord (código: HTTP_403).");
});

test("cancelar durante a espera limpa o timer, não loga e não tenta de novo", async () => {
  const s = setup([network(), null]);
  const outcome = s.loop.run();
  await tick();
  s.loop.cancel();
  assert.deepEqual(await outcome, { status: "cancelled" });
  assert.equal(s.timers[0]!.cleared, true);
  s.timers[0]!.fn();
  await tick();
  assert.deepEqual(s.attempts, [1]);
  assert.equal(s.logs.length, 1);
});

test("cancelar com a tentativa em andamento: a falha que vem depois não loga nem agenda", async () => {
  let reject: (error: Error) => void = () => {};
  const logs: string[] = [];
  const timers: unknown[] = [];
  const loop = createLoginLoop({
    attempt: () => new Promise<void>((_, r) => (reject = r)),
    log: (line) => logs.push(line),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => {},
  });
  const outcome = loop.run();
  loop.cancel();
  reject(network());
  assert.deepEqual(await outcome, { status: "cancelled" });
  assert.deepEqual(logs, []);
  assert.equal(timers.length, 0);
});
