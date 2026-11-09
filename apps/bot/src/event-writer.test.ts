import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DiskQueue } from "./event-queue.ts";
import { createEventWriter, HEARTBEAT_MS, RETRY_DELAYS_MS, type EventWriterDeps } from "./event-writer.ts";
import { botMarker, eventFromTransition, type QueuedEvent } from "./raw-event.ts";

const G = "900000000000000001";
const U = "100000000000000001";
const A = "500000000000000001";
const B = "500000000000000002";
const MIN = 60_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Relógio e timers falsos: `advance` dispara o que vence e espera as promessas pendentes. */
class FakeClock {
  ms = Date.parse("2026-11-09T12:00:00.000Z");
  #timers = new Map<number, { at: number; fn: () => void }>();
  #next = 1;
  now = () => new Date(this.ms);
  setTimer = (fn: () => void, delay: number) => {
    const id = this.#next++;
    this.#timers.set(id, { at: this.ms + delay, fn });
    return id;
  };
  clearTimer = (id: unknown) => {
    this.#timers.delete(id as number);
  };
  get pending(): number {
    return this.#timers.size;
  }
  async advance(delay: number): Promise<void> {
    const end = this.ms + delay;
    for (;;) {
      await settle();
      const due = [...this.#timers].filter(([, t]) => t.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
      if (!due) break;
      this.#timers.delete(due[0]);
      this.ms = Math.max(this.ms, due[1].at);
      due[1].fn();
    }
    this.ms = end;
    await settle();
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

type FakeDb = {
  rows: QueuedEvent[];
  calls: number;
  down: boolean;
  /** Chaves que o banco recusa, como se violassem uma restrição. */
  reject: Set<string>;
  insert: EventWriterDeps["insert"];
};

function fakeDb(): FakeDb {
  const db: FakeDb = {
    rows: [],
    calls: 0,
    down: false,
    reject: new Set(),
    async insert(events) {
      db.calls += 1;
      if (db.down) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
      if (events.some((e) => db.reject.has(e.idempotencyKey))) {
        const driver = Object.assign(new Error(`viola ${U}`), { code: "23514" });
        throw new Error(`Failed query params: ${U}`, { cause: driver });
      }
      let inserted = 0;
      for (const e of events) {
        if (db.rows.some((r) => r.idempotencyKey === e.idempotencyKey)) continue;
        db.rows.push(e);
        inserted += 1;
      }
      return inserted;
    },
  };
  return db;
}

function setup(options: { dir?: string; db?: FakeDb; clock?: FakeClock } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "bot-writer-"));
  if (!options.dir) dirs.push(dir);
  const clock = options.clock ?? new FakeClock();
  const db = options.db ?? fakeDb();
  const lines: string[] = [];
  let key = 0;
  const { queue } = DiskQueue.open(dir);
  const writer = createEventWriter({
    queue,
    insert: db.insert,
    log: (line) => lines.push(line),
    now: clock.now,
    newKey: () => `00000000-0000-4000-8000-${String(++key).padStart(12, "0")}`,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { dir, clock, db, lines, queue, writer };
}

function joinAt(at: Date) {
  return eventFromTransition(G, U, "join", null, A, at)!;
}

test("evento gravado logo depois de observado, com a chave e o horário da observação", async () => {
  const { clock, db, writer, queue } = setup();
  writer.start();
  writer.record(joinAt(clock.now()));
  await clock.advance(0);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0]!.eventType, "voice_join");
  assert.equal(db.rows[0]!.occurredAt, "2026-11-09T12:00:00.000Z");
  assert.equal(queue.size, 0);
});

test("vários eventos no mesmo instante vão num só acesso ao banco", async () => {
  const { clock, db, writer } = setup();
  writer.start();
  for (let i = 0; i < 5; i += 1) writer.record(joinAt(clock.now()));
  await clock.advance(0);
  assert.equal(db.calls, 1);
  assert.equal(db.rows.length, 5);
});

test("sem eventos, o único acesso ao banco é o sinal a cada 30 min", async () => {
  const { clock, db, writer, lines } = setup();
  writer.start();
  await clock.advance(HEARTBEAT_MS - 1);
  assert.equal(db.calls, 0, "nenhum acesso antes de 30 min");
  await clock.advance(1);
  assert.equal(db.calls, 1);
  await clock.advance(2 * 60 * MIN - HEARTBEAT_MS);
  assert.equal(db.calls, 4, "4 sinais em 2 h");
  assert.deepEqual(new Set(db.rows.map((r) => r.eventType)), new Set(["bot_heartbeat"]));
  assert.match(lines.at(-1)!, /^\[db\] \S+Z acesso=4 motivo=sinal gravados=1 novos=1 pendentes=0$/);
});

test("o log conta os acessos e nunca traz IDs do Discord nem a mensagem do erro", async () => {
  const { clock, db, writer, lines } = setup();
  writer.start();
  writer.record(joinAt(clock.now()));
  await clock.advance(0);
  db.down = true;
  writer.record(joinAt(clock.now()));
  await clock.advance(0);
  db.down = false;
  db.reject.add("00000000-0000-4000-8000-000000000003");
  writer.record(joinAt(clock.now()));
  await clock.advance(10 * MIN);
  assert.match(lines[0]!, /^\[db\] \S+Z acesso=1 motivo=eventos gravados=1 novos=1 pendentes=0$/);
  assert.match(lines[1]!, /^\[db\] \S+Z acesso=2 falhou \(código: ECONNREFUSED\); pendentes=1; nova tentativa em 5 s$/);
  assert.ok(lines.some((l) => /acesso=\d+ evento recusado pelo banco \(código: 23514\); separado em quarentena/.test(l)));
  const all = lines.join("\n");
  for (const secret of [U, G, A, "ECONNREFUSED 127.0.0.1", "Failed query", "viola"]) {
    assert.ok(!all.includes(secret), `o log trouxe ${secret}:\n${all}`);
  }
});

test("banco fora por 10 min: o bot não cai, guarda tudo e grava na ordem, sem duplicar, quando ele volta", async () => {
  const { clock, db, writer, queue } = setup();
  writer.start();
  db.down = true;
  for (let minute = 0; minute < 10; minute += 1) {
    writer.record(joinAt(clock.now()));
    writer.record(eventFromTransition(G, U, "move", A, B, clock.now())!);
    writer.record(eventFromTransition(G, U, "leave", B, null, clock.now())!);
    await clock.advance(MIN);
  }
  const sent = queue.peek(100).map((e) => e.idempotencyKey);
  assert.equal(queue.size, 30);
  assert.equal(db.rows.length, 0);
  assert.ok(db.calls <= 12, `tentativas demais com o banco fora: ${db.calls}`);
  db.down = false;
  await clock.advance(RETRY_DELAYS_MS.at(-1)!);
  assert.equal(queue.size, 0);
  assert.deepEqual(db.rows.map((r) => r.idempotencyKey), sent, "na ordem e sem duplicar");
});

test("as novas tentativas esperam cada vez mais, até um teto, e voltam ao início depois do sucesso", async () => {
  const { clock, db, writer, lines } = setup();
  writer.start();
  db.down = true;
  writer.record(joinAt(clock.now()));
  await clock.advance(60 * MIN);
  const waits = lines.map((l) => Number(/nova tentativa em (\d+) s/.exec(l)?.[1])).filter(Boolean);
  assert.deepEqual(waits.slice(0, RETRY_DELAYS_MS.length), RETRY_DELAYS_MS.map((ms) => ms / 1000));
  assert.ok(waits.slice(RETRY_DELAYS_MS.length).every((s) => s === RETRY_DELAYS_MS.at(-1)! / 1000));
  db.down = false;
  await clock.advance(RETRY_DELAYS_MS.at(-1)!);
  db.down = true;
  lines.length = 0;
  writer.record(joinAt(clock.now()));
  await clock.advance(0);
  assert.match(lines.at(-1)!, /nova tentativa em 5 s$/);
});

test("evento novo durante a espera não antecipa a nova tentativa", async () => {
  const { clock, db, writer } = setup();
  writer.start();
  db.down = true;
  writer.record(joinAt(clock.now()));
  await clock.advance(0);
  const calls = db.calls;
  writer.record(joinAt(clock.now()));
  writer.record(joinAt(clock.now()));
  await clock.advance(RETRY_DELAYS_MS[0]! - 1);
  assert.equal(db.calls, calls);
});

test("linha recusada pelo banco vai para a quarentena sem travar nem perder as outras", async () => {
  const { clock, db, writer, queue } = setup();
  writer.start();
  db.down = true;
  for (let i = 0; i < 5; i += 1) writer.record(joinAt(clock.now()));
  await clock.advance(0);
  db.down = false;
  db.reject.add(queue.peek(5)[2]!.idempotencyKey);
  const expected = queue.peek(5).map((e) => e.idempotencyKey).filter((k) => !db.reject.has(k));
  await clock.advance(RETRY_DELAYS_MS[0]!);
  assert.equal(queue.size, 0);
  assert.deepEqual(db.rows.map((r) => r.idempotencyKey), expected);
});

test("religar com a fila cheia grava o que ficou, sem duplicar o que já tinha sido gravado", async () => {
  const db = fakeDb();
  const first = setup({ db });
  first.writer.start();
  first.writer.record(joinAt(first.clock.now()));
  await first.clock.advance(0);
  db.down = true;
  first.writer.record(joinAt(first.clock.now()));
  first.writer.record(joinAt(first.clock.now()));
  await first.clock.advance(0);
  // O processo morre aqui, sem close(). Antes, o banco tinha gravado um evento que ainda está
  // na fila (morte entre a confirmação e a remoção).
  db.down = false;
  await db.insert(first.queue.peek(1));
  const second = setup({ db, dir: first.dir });
  assert.equal(second.queue.size, 2);
  second.writer.start();
  await second.clock.advance(0);
  assert.equal(second.queue.size, 0);
  assert.equal(db.rows.length, 3);
  assert.equal(new Set(db.rows.map((r) => r.idempotencyKey)).size, 3);
});

test("close tenta gravar o que falta, para os timers e não loga nada", async () => {
  const { clock, db, writer, lines, queue } = setup();
  writer.start();
  db.down = true;
  writer.record(joinAt(clock.now()));
  await clock.advance(0);
  lines.length = 0;
  db.down = false;
  writer.record(botMarker("bot_stop", clock.now()));
  await writer.close();
  assert.equal(queue.size, 0);
  assert.deepEqual(db.rows.map((r) => r.eventType), ["voice_join", "bot_stop"]);
  assert.deepEqual(lines, []);
  assert.equal(clock.pending, 0, "nenhum timer depois do close");
  const calls = db.calls;
  writer.record(joinAt(clock.now()));
  await clock.advance(HEARTBEAT_MS * 2);
  assert.equal(db.calls, calls, "depois do close, nada mais acessa o banco");
});

test("close com o banco fora não tenta de novo: o evento fica na fila", async () => {
  const { clock, db, writer, queue } = setup();
  writer.start();
  db.down = true;
  writer.record(botMarker("bot_stop", clock.now()));
  await writer.close();
  assert.equal(queue.size, 1);
  assert.equal(clock.pending, 0);
});

test("falha ao escrever na fila em disco é logada só pelo código e não derruba o bot", () => {
  const { clock, writer, lines, queue } = setup();
  writer.start();
  queue.append = () => {
    throw Object.assign(new Error(`EROFS: read-only file system, open '/x/${U}'`), { code: "EROFS" });
  };
  assert.doesNotThrow(() => writer.record(joinAt(clock.now())));
  assert.deepEqual(lines, ["[fila] erro: evento não guardado na fila em disco (código: EROFS)."]);
});

test("disco cheio ao tirar da fila: agenda nova tentativa com espera, e o reenvio não duplica", async () => {
  const { clock, db, writer, lines, queue } = setup();
  writer.start();
  const realDrop = queue.drop.bind(queue);
  let failures = 2;
  queue.drop = (count) => {
    if (failures > 0) {
      failures -= 1;
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    }
    realDrop(count);
  };
  writer.record(joinAt(clock.now()));
  await clock.advance(0);
  assert.equal(db.rows.length, 1);
  assert.equal(queue.size, 1);
  assert.match(lines.at(-1)!, /^\[fila\] erro ao atualizar a fila em disco \(código: ENOSPC\); nova tentativa em 5 s$/);
  await clock.advance(RETRY_DELAYS_MS[0]!);
  assert.match(lines.at(-1)!, /nova tentativa em 15 s$/);
  await clock.advance(RETRY_DELAYS_MS[1]!);
  assert.equal(queue.size, 0);
  assert.equal(db.rows.length, 1, "o reenvio do mesmo lote não duplicou");
  assert.match(lines.at(-1)!, /gravados=1 novos=0 pendentes=0$/);
});
