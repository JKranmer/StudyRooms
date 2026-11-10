import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DiskQueue, PENDING_FILE, QUARANTINE_FILE } from "./event-queue.ts";
import { botMarker, toQueuedEvent, type QueuedEvent } from "./raw-event.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bot-fila-"));
  dirs.push(dir);
  return dir;
}

let n = 0;
function event(): QueuedEvent {
  n += 1;
  const key = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return toQueuedEvent(botMarker("bot_heartbeat", new Date(Date.UTC(2026, 10, 9, 0, 0, n))), key);
}

test("cria a pasta da fila se não existir e começa vazia", () => {
  const dir = join(tempDir(), "sub", "fila");
  const { queue, loaded, damaged } = DiskQueue.open(dir);
  assert.equal(queue.size, 0);
  assert.equal(loaded, 0);
  assert.equal(damaged, 0);
  assert.ok(existsSync(dir));
});

test("o que entra na fila sobrevive a reabrir (processo morto) e mantém a ordem", () => {
  const dir = tempDir();
  const events = [event(), event(), event()];
  const first = DiskQueue.open(dir).queue;
  for (const e of events) first.append(e);
  const { queue, loaded } = DiskQueue.open(dir);
  assert.equal(loaded, 3);
  assert.deepEqual(queue.peek(10), events);
});

test("peek não remove; drop remove do início e persiste", () => {
  const dir = tempDir();
  const events = [event(), event(), event()];
  const { queue } = DiskQueue.open(dir);
  for (const e of events) queue.append(e);
  assert.deepEqual(queue.peek(2), events.slice(0, 2));
  assert.equal(queue.size, 3);
  queue.drop(2);
  assert.deepEqual(queue.peek(10), events.slice(2));
  assert.deepEqual(DiskQueue.open(dir).queue.peek(10), events.slice(2));
});

test("o que entra depois do peek não se perde no drop", () => {
  const dir = tempDir();
  const { queue } = DiskQueue.open(dir);
  const [a, b, c] = [event(), event(), event()];
  queue.append(a);
  queue.append(b);
  const batch = queue.peek(10);
  queue.append(c);
  queue.drop(batch.length);
  assert.deepEqual(DiskQueue.open(dir).queue.peek(10), [c]);
});

test("linha cortada no fim (queda no meio da escrita) vai para a quarentena e as demais seguem", () => {
  const dir = tempDir();
  const [a, b] = [event(), event()];
  const { queue } = DiskQueue.open(dir);
  queue.append(a);
  queue.append(b);
  appendFileSync(join(dir, PENDING_FILE), '{"idempotencyKey":"00000000-0000-4000-8000-0000000');
  const reopened = DiskQueue.open(dir);
  assert.equal(reopened.loaded, 2);
  assert.equal(reopened.damaged, 1);
  assert.deepEqual(reopened.queue.peek(10), [a, b]);
  const quarantined = readFileSync(join(dir, QUARANTINE_FILE), "utf8").trim().split("\n");
  assert.equal(quarantined.length, 1);
  assert.equal(JSON.parse(quarantined[0]!).reason, "linha_ilegivel");
  // A fila foi regravada sem a linha cortada: reabrir não a separa de novo.
  assert.equal(DiskQueue.open(dir).damaged, 0);
});

test("linhas vazias e finais de linha do Windows não atrapalham a leitura", () => {
  const dir = tempDir();
  const a = event();
  writeFileSync(join(dir, PENDING_FILE), `\r\n${JSON.stringify(a)}\r\n\n`);
  const { queue, damaged } = DiskQueue.open(dir);
  assert.equal(damaged, 0);
  assert.deepEqual(queue.peek(10), [a]);
});

test("quarentena guarda o evento e o código, e não volta para a fila", () => {
  const dir = tempDir();
  const [a, b] = [event(), event()];
  const { queue } = DiskQueue.open(dir);
  queue.append(a);
  queue.append(b);
  queue.quarantineFirst("23514");
  assert.deepEqual(queue.peek(10), [b]);
  const line = JSON.parse(readFileSync(join(dir, QUARANTINE_FILE), "utf8").trim());
  assert.equal(line.reason, "recusado_pelo_banco");
  assert.equal(line.code, "23514");
  assert.deepEqual(line.event, a);
  assert.deepEqual(DiskQueue.open(dir).queue.peek(10), [b]);
});

test("arquivo temporário de uma regravação interrompida é ignorado", () => {
  const dir = tempDir();
  const a = event();
  DiskQueue.open(dir).queue.append(a);
  writeFileSync(join(dir, `${PENDING_FILE}.tmp`), "lixo parcial");
  const { queue, damaged } = DiskQueue.open(dir);
  assert.equal(damaged, 0);
  assert.deepEqual(queue.peek(10), [a]);
});

// Disco quase cheio: o Linux pode gravar só parte do pedido sem lançar erro (write curto).
type Write = NonNullable<Parameters<typeof DiskQueue.open>[1]>["write"];

/** Grava no máximo `chunk` bytes por chamada, como um write curto, sem nunca falhar. */
function shortWrites(chunk: number): Write {
  return (fd, buffer, offset, length) => writeSync(fd, buffer, offset, Math.min(chunk, length));
}

/** Disco com `free` bytes livres: grava até acabar e depois falha com ENOSPC, como o Linux. */
function fullDisk(state: { free: number }): Write {
  return (fd, buffer, offset, length) => {
    if (state.free <= 0) throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    const n = Math.min(length, state.free);
    state.free -= n;
    return writeSync(fd, buffer, offset, n);
  };
}

test("write curto: repete até gravar a linha inteira", () => {
  const dir = tempDir();
  const events = [event(), event(), event()];
  const { queue } = DiskQueue.open(dir, { write: shortWrites(7) });
  for (const e of events) queue.append(e);
  queue.drop(1);
  const reopened = DiskQueue.open(dir);
  assert.equal(reopened.damaged, 0);
  assert.deepEqual(reopened.queue.peek(10), events.slice(1));
});

test("disco cheio no append: lança, desfaz a linha cortada e o próximo evento não é corrompido", () => {
  const dir = tempDir();
  const state = { free: Number.POSITIVE_INFINITY };
  const { queue } = DiskQueue.open(dir, { write: fullDisk(state) });
  const [a, b, c] = [event(), event(), event()];
  queue.append(a);
  state.free = 20;
  assert.throws(() => queue.append(b), { code: "ENOSPC" });
  assert.equal(queue.size, 1, "o evento que não coube não entra na fila em memória");
  assert.equal(readFileSync(join(dir, PENDING_FILE), "utf8"), `${JSON.stringify(a)}\n`, "a linha cortada foi desfeita");
  state.free = Number.POSITIVE_INFINITY;
  queue.append(c);
  const reopened = DiskQueue.open(dir);
  assert.equal(reopened.damaged, 0);
  assert.deepEqual(reopened.queue.peek(10), [a, c]);
});

test("disco cheio ao regravar (drop): lança, não troca a fila pelo arquivo cortado e não perde nada", () => {
  const dir = tempDir();
  const state = { free: Number.POSITIVE_INFINITY };
  const { queue } = DiskQueue.open(dir, { write: fullDisk(state) });
  const events = Array.from({ length: 10 }, () => event());
  for (const e of events) queue.append(e);
  state.free = 30;
  assert.throws(() => queue.drop(2), { code: "ENOSPC" });
  assert.equal(queue.size, 10, "a fila em memória continua igual ao disco");
  assert.ok(!existsSync(join(dir, `${PENDING_FILE}.tmp`)), "o temporário cortado foi apagado");
  const reopened = DiskQueue.open(dir);
  assert.equal(reopened.damaged, 0);
  assert.deepEqual(reopened.queue.peek(20), events);
  state.free = Number.POSITIVE_INFINITY;
  queue.drop(2);
  assert.deepEqual(DiskQueue.open(dir).queue.peek(20), events.slice(2));
});

test("write que devolve 0 bytes sem erro não vira laço infinito", () => {
  const dir = tempDir();
  const { queue } = DiskQueue.open(dir, { write: () => 0 });
  assert.throws(() => queue.append(event()), { code: "ENOSPC" });
  assert.equal(queue.size, 0);
});

// Observação do Theo (F1-47): religar com o disco cheio e linhas ilegíveis na fila fazia o bot sair.
const DAMAGED = '{"idempotencyKey":"cortada';

test("disco cheio ao reabrir com linha ilegível: abre mesmo assim e mantém a linha na fila", () => {
  const dir = tempDir();
  const [a, b] = [event(), event()];
  const original = `${JSON.stringify(a)}\n${DAMAGED}\n${JSON.stringify(b)}\n`;
  writeFileSync(join(dir, PENDING_FILE), original);
  const state = { free: 0 };
  const opened = DiskQueue.open(dir, { write: fullDisk(state) });
  assert.equal(opened.loaded, 2);
  assert.equal(opened.damaged, 1);
  assert.equal(opened.quarantineError, "ENOSPC");
  assert.deepEqual(opened.queue.peek(10), [a, b]);
  assert.equal(readFileSync(join(dir, PENDING_FILE), "utf8"), original, "a fila não foi tocada");
});

test("linha ilegível mantida por disco cheio vai para a quarentena na próxima regravação", () => {
  const dir = tempDir();
  const [a, b] = [event(), event()];
  writeFileSync(join(dir, PENDING_FILE), `${JSON.stringify(a)}\n${DAMAGED}\n${JSON.stringify(b)}\n`);
  const state = { free: 0 };
  const { queue } = DiskQueue.open(dir, { write: fullDisk(state) });
  state.free = Number.POSITIVE_INFINITY;
  queue.drop(1);
  const quarantined = readFileSync(join(dir, QUARANTINE_FILE), "utf8").trim().split("\n");
  assert.equal(quarantined.length, 1);
  assert.equal(JSON.parse(quarantined[0]!).line, DAMAGED);
  const reopened = DiskQueue.open(dir);
  assert.equal(reopened.damaged, 0);
  assert.deepEqual(reopened.queue.peek(10), [b]);
});

test("linha ilegível mantida por disco cheio não se perde se a regravação ainda falhar", () => {
  const dir = tempDir();
  const [a, b] = [event(), event()];
  writeFileSync(join(dir, PENDING_FILE), `${JSON.stringify(a)}\n${DAMAGED}\n${JSON.stringify(b)}\n`);
  const state = { free: 0 };
  const { queue } = DiskQueue.open(dir, { write: fullDisk(state) });
  assert.throws(() => queue.drop(1), { code: "ENOSPC" });
  const reopened = DiskQueue.open(dir);
  assert.equal(reopened.damaged, 1, "a linha ilegível continua na fila, para a quarentena da próxima abertura");
  assert.deepEqual(reopened.queue.peek(10), [a, b]);
});

test("quarentena gravada mas regravação da fila sem espaço ao reabrir: abre e não separa a linha duas vezes", () => {
  const dir = tempDir();
  const [a, b] = [event(), event()];
  writeFileSync(join(dir, PENDING_FILE), `${JSON.stringify(a)}\n${DAMAGED}\n${JSON.stringify(b)}\n`);
  let calls = 0;
  const failAfterFirst: Write = (fd, buffer, offset, length) => {
    calls += 1;
    if (calls > 1) throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    return writeSync(fd, buffer, offset, length);
  };
  const opened = DiskQueue.open(dir, { write: failAfterFirst });
  assert.equal(opened.damaged, 1);
  assert.equal(opened.quarantineError, null);
  calls = Number.NEGATIVE_INFINITY;
  opened.queue.drop(1);
  const reopened = DiskQueue.open(dir);
  assert.equal(reopened.damaged, 0);
  assert.deepEqual(reopened.queue.peek(10), [b]);
  assert.equal(readFileSync(join(dir, QUARANTINE_FILE), "utf8").trim().split("\n").length, 1);
});
