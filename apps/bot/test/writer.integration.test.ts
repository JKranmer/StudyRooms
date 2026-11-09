// Fila em disco + gravador contra um Postgres real (Testcontainers). Precisa do Docker ligado.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { createDb, insertRawVoiceEvents, type DbHandle } from "@studyrooms/db";
import { DiskQueue, QUARANTINE_FILE } from "../src/event-queue.ts";
import { createEventWriter, type EventWriter } from "../src/event-writer.ts";
import { botMarker, eventFromTransition, toRow, type RawEventInput } from "../src/raw-event.ts";
import { eventually, proxyFor, readRows, startPostgres, tempDir, type TcpProxy } from "./support.ts";

const G = "900000000000000001";
const U = "100000000000000001";
const A = "500000000000000001";
const B = "500000000000000002";

let container: StartedPostgreSqlContainer;
let admin: pg.Client;
let proxy: TcpProxy;

before(async () => {
  container = await startPostgres();
  admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  proxy = proxyFor(container);
  await proxy.up();
});

after(async () => {
  await proxy?.down();
  await admin?.end();
  await container?.stop();
});

type Harness = {
  dir: string;
  writer: EventWriter;
  queue: DiskQueue;
  lines: string[];
  close: () => Promise<void>;
};

const cleanups: (() => Promise<void> | void)[] = [];

beforeEach(async () => {
  await proxy.up();
  await admin.query("truncate raw_voice_events");
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function harness(dir?: string): Harness {
  const temp = dir ? null : tempDir("bot-integracao-");
  const queueDir = dir ?? temp!.dir;
  const { queue } = DiskQueue.open(queueDir);
  const database: DbHandle = createDb(proxy.url(container), {
    pool: { max: 1, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 2_000, queryTimeoutMillis: 5_000 },
  });
  const lines: string[] = [];
  const writer = createEventWriter({
    queue,
    insert: (events) => insertRawVoiceEvents(database.db, events.map(toRow)),
    log: (line) => lines.push(line),
    now: () => new Date(),
    newKey: () => randomUUID(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    retryDelaysMs: [100, 200, 400],
  });
  const close = async () => {
    await writer.close();
    await database.close();
  };
  cleanups.push(close);
  if (temp) cleanups.push(temp.remove);
  return { dir: queueDir, writer, queue, lines, close };
}

function join_(channel = A): RawEventInput {
  return eventFromTransition(G, U, "join", null, channel, new Date())!;
}

async function count(): Promise<number> {
  const { rows } = await admin.query<{ n: number }>("select count(*)::int as n from raw_voice_events");
  return rows[0]!.n;
}

describe("gravador com Postgres real", { concurrency: 1, timeout: 120_000 }, () => {
  test("grava entrada, troca, saída e marcos do bot em UTC, na ordem observada", async () => {
    const { writer, queue } = harness();
    writer.start();
    const at = new Date("2026-11-09T23:59:59.999-03:00");
    writer.record(botMarker("bot_start", at));
    writer.record(eventFromTransition(G, U, "join", null, A, at)!);
    writer.record(eventFromTransition(G, U, "move", A, B, at)!);
    writer.record(eventFromTransition(G, U, "leave", B, null, at)!);
    await eventually(() => queue.size === 0);
    const rows = await readRows(admin);
    assert.deepEqual(
      rows.map((r) => [r.event_type, r.discord_user_id, r.guild_id, r.from_channel_id, r.to_channel_id, r.occurred_utc]),
      [
        ["bot_start", null, null, null, null, "2026-11-10T02:59:59.999Z"],
        ["voice_join", U, G, null, A, "2026-11-10T02:59:59.999Z"],
        ["voice_move", U, G, A, B, "2026-11-10T02:59:59.999Z"],
        ["voice_leave", U, G, B, null, "2026-11-10T02:59:59.999Z"],
      ],
    );
  });

  test("banco fora: o gravador não lança, guarda tudo e grava na ordem e sem duplicar quando ele volta", async () => {
    const { writer, queue, lines } = harness();
    writer.start();
    await proxy.down();
    const expected: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      writer.record(join_(i % 2 ? A : B));
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expected.push(...queue.peek(100).map((e) => e.idempotencyKey));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(await count(), 0);
    assert.equal(queue.size, 50);
    assert.ok(lines.some((l) => /falhou \(código: /.test(l)), lines.join("\n"));
    await proxy.up();
    await eventually(() => queue.size === 0);
    const rows = await readRows(admin);
    assert.deepEqual(rows.map((r) => r.idempotency_key), expected);
    const all = lines.join("\n");
    assert.ok(!all.includes(U) && !all.includes(G) && !all.includes(container.getPassword()), all);
  });

  test("morrer entre a gravação e a remoção da fila: religar reenvia e o banco não duplica", async () => {
    const first = harness();
    await proxy.down();
    first.writer.start();
    for (let i = 0; i < 5; i += 1) first.writer.record(join_());
    // O banco grava (outra conexão) e o processo "morre" antes de tirar os eventos da fila.
    const direct = createDb(container.getConnectionUri());
    try {
      await insertRawVoiceEvents(direct.db, first.queue.peek(3).map(toRow));
    } finally {
      await direct.close();
    }
    await proxy.up();
    const second = harness(first.dir);
    assert.equal(second.queue.size, 5);
    second.writer.start();
    await eventually(() => second.queue.size === 0);
    assert.equal(await count(), 5);
    assert.match(second.lines.join("\n"), /gravados=5 novos=2 pendentes=0/);
  });

  test("linha recusada pelo banco (23514) vai para a quarentena e as outras são gravadas", async () => {
    const { writer, queue, dir, lines } = harness();
    await proxy.down();
    writer.start();
    writer.record(join_());
    writer.record({ ...join_(), guildId: "nao-e-snowflake" });
    writer.record(join_(B));
    await proxy.up();
    await eventually(() => queue.size === 0);
    const rows = await readRows(admin);
    assert.deepEqual(rows.map((r) => r.to_channel_id), [A, B]);
    const quarantined = readFileSync(join(dir, QUARANTINE_FILE), "utf8").trim().split("\n");
    assert.equal(quarantined.length, 1);
    assert.equal(JSON.parse(quarantined[0]!).code, "23514");
    assert.ok(lines.some((l) => /evento recusado pelo banco \(código: 23514\)/.test(l)));
  });

  test("matar o processo (SIGKILL) com a fila cheia e religar não perde nem duplica eventos", async () => {
    const { dir, remove } = tempDir("bot-kill-");
    cleanups.push(remove);
    await proxy.down();
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./fill-queue-child.ts", import.meta.url)), dir, proxy.url(container), "200"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let output = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    await eventually(() => output.includes("pronto"), 20_000);
    assert.match(output, /pronto 200/);
    child.kill("SIGKILL");
    await once(child, "exit");
    await proxy.up();
    const second = harness(dir);
    assert.equal(second.queue.size, 200);
    const keys = second.queue.peek(200).map((e) => e.idempotencyKey);
    second.writer.start();
    await eventually(() => second.queue.size === 0);
    const rows = await readRows(admin);
    assert.deepEqual(rows.map((r) => r.idempotency_key), keys);
  });
});
