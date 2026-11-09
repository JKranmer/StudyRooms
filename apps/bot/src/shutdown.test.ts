import assert from "node:assert/strict";
import { test } from "node:test";
import { createShutdown } from "./shutdown.ts";

function setup({ destroy }: { destroy?: () => Promise<unknown> } = {}) {
  const calls: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let resolveDestroy: () => void = () => {};
  let rejectDestroy: (error: Error) => void = () => {};
  const shutdown = createShutdown({
    graceMs: 3_000,
    stop: () => calls.push("stop"),
    destroy:
      destroy ??
      (() => {
        calls.push("destroy");
        return new Promise<void>((resolve, reject) => {
          resolveDestroy = resolve;
          rejectDestroy = reject;
        });
      }),
    exit: (code) => calls.push(`exit ${code}`),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
    },
  });
  return {
    shutdown,
    calls,
    timers,
    resolveDestroy: () => resolveDestroy(),
    rejectDestroy: (error: Error) => rejectDestroy(error),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("encerra com o código pedido depois que o cliente fecha", async () => {
  const s = setup();
  s.shutdown(0);
  assert.deepEqual(s.calls, ["stop", "destroy"]);
  s.resolveDestroy();
  await tick();
  assert.deepEqual(s.calls, ["stop", "destroy", "exit 0"]);
});

test("se o cliente não fecha (login ou reconexão pendentes), sai no fim do prazo", async () => {
  const s = setup();
  s.shutdown(0);
  assert.equal(s.timers.length, 1);
  assert.equal(s.timers[0]!.ms, 3_000);
  s.timers[0]!.fn();
  assert.deepEqual(s.calls, ["stop", "destroy", "exit 0"]);
});

test("falha ao fechar o cliente não impede a saída", async () => {
  const s = setup();
  s.shutdown(1);
  s.rejectDestroy(new Error("x"));
  await tick();
  assert.deepEqual(s.calls, ["stop", "destroy", "exit 1"]);
});

test("destroy que lança de forma síncrona não impede a saída", () => {
  const s = setup({
    destroy: () => {
      throw new Error("x");
    },
  });
  s.shutdown(0);
  assert.deepEqual(s.calls, ["stop", "exit 0"]);
});

test("sai uma vez só, mesmo que o prazo vença depois do fechamento", async () => {
  const s = setup();
  s.shutdown(0);
  s.resolveDestroy();
  await tick();
  s.timers[0]!.fn();
  assert.deepEqual(s.calls, ["stop", "destroy", "exit 0"]);
});

test("um segundo pedido (segundo Ctrl+C) sai na hora, com o código do primeiro", () => {
  const s = setup();
  s.shutdown(1);
  s.shutdown(0);
  assert.deepEqual(s.calls, ["stop", "destroy", "exit 1"]);
});

test("informa se o encerramento já começou", () => {
  const s = setup();
  assert.equal(s.shutdown.started, false);
  s.shutdown(0);
  assert.equal(s.shutdown.started, true);
});
