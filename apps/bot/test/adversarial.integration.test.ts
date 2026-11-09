// Casos de falha procurados pelo QA (F1-47): banco que não responde, consulta presa, morte do
// processo em pontos aleatórios, fila corrompida e consentimento nos arquivos da fila.
// Precisa do Docker ligado (Testcontainers).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { PENDING_FILE, QUARANTINE_FILE } from "../src/event-queue.ts";
import {
  BotProcess,
  FakeDiscord,
  GUILD,
  ME,
  OTHER,
  SALA_1,
  SALA_2,
  tempQueueDir,
} from "../src/fake-discord.test-helper.ts";
import { eventually, proxyFor, readRows, startPostgres, type TcpProxy } from "./support.ts";

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

beforeEach(async () => {
  await proxy.up();
  await admin.query("truncate raw_voice_events");
});

/** "Banco" que aceita a conexão e nunca responde: rede presa, não recusada. */
async function blackhole(): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `postgres://bot:senha-falsa@127.0.0.1:${port}/studyrooms`,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

function queueText(dir: string): string {
  return readdirSync(dir)
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

function pendingCount(dir: string): number {
  const path = join(dir, PENDING_FILE);
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).length;
}

function summary(rows: Awaited<ReturnType<typeof readRows>>): string[] {
  return rows.map((r) => [r.event_type, r.discord_user_id, r.from_channel_id, r.to_channel_id].join(" ").trim());
}

describe("F1-47: casos de falha (QA)", { concurrency: 1, timeout: 240_000 }, () => {
  test("banco que não responde: SIGTERM encerra em até 4 s e os eventos ficam na fila; ao religar, grava sem duplicar", async () => {
    const hole = await blackhole();
    const queueDir = tempQueueDir();
    const fake = new FakeDiscord();
    await fake.start();
    fake.setVoice(ME, SALA_1);
    const first = new BotProcess(fake, { databaseUrl: hole.url, queueDir });
    try {
      await first.waitFor(/estado inicial: 1 da allowlist/);
      fake.emitVoice(ME, SALA_2);
      await first.waitFor(/ trocou de="Sala 1" /);
      const started = Date.now();
      first.terminate();
      assert.equal(await first.waitExit(8_000), 0);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 4_000, `encerrou em ${elapsed} ms`);
    } finally {
      await first.kill();
      await hole.close();
    }
    // bot_start, voice_present, voice_move, bot_stop
    assert.equal(pendingCount(queueDir), 4, queueText(queueDir));
    assert.equal((await readRows(admin)).length, 0);

    fake.setVoice(ME, null);
    const second = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir });
    try {
      await second.waitFor(/4 evento\(s\) pendente\(s\)/);
      await second.waitFor(/estado inicial: 0 da allowlist/);
      await eventually(async () => (await readRows(admin)).length >= 5);
      second.terminate();
      assert.equal(await second.waitExit(5_000), 0);
    } finally {
      await second.kill();
      await fake.stop();
    }
    const rows = await readRows(admin);
    assert.deepEqual(summary(rows), [
      "bot_start",
      `voice_present ${ME}  ${SALA_1}`,
      `voice_move ${ME} ${SALA_1} ${SALA_2}`,
      "bot_stop",
      "bot_start",
      "bot_stop",
    ]);
    assert.equal(pendingCount(queueDir), 0);
  });

  test("insert preso por lock: SIGTERM encerra em até 4 s; o insert que o banco concluir depois não duplica no reenvio", async () => {
    const queueDir = tempQueueDir();
    const fake = new FakeDiscord();
    await fake.start();
    const locker = new pg.Client({ connectionString: container.getConnectionUri() });
    await locker.connect();
    const first = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir });
    try {
      await first.waitFor(/estado inicial: 0 da allowlist/);
      await eventually(async () => (await readRows(admin)).length >= 1);
      await locker.query("begin");
      await locker.query("lock table raw_voice_events in access exclusive mode");
      fake.emitVoice(ME, SALA_1);
      await first.waitFor(/ entrou canal="Sala 1" /);
      await new Promise((r) => setTimeout(r, 500));
      const started = Date.now();
      first.terminate();
      assert.equal(await first.waitExit(8_000), 0);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 4_000, `encerrou em ${elapsed} ms`);
    } finally {
      await locker.query("commit").catch(() => {});
      await locker.end();
      await first.kill();
    }
    await new Promise((r) => setTimeout(r, 1_000));
    const second = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir });
    try {
      await second.waitFor(/estado inicial/);
      await eventually(async () => pendingCount(queueDir) === 0);
      second.terminate();
      assert.equal(await second.waitExit(5_000), 0);
    } finally {
      await second.kill();
      await fake.stop();
    }
    const rows = await readRows(admin);
    assert.equal(new Set(rows.map((r) => r.idempotency_key)).size, rows.length);
    const joins = rows.filter((r) => r.event_type === "voice_join");
    assert.equal(joins.length, 1, summary(rows).join("\n"));
    assert.deepEqual(
      summary(rows).filter((s) => s !== "bot_start" && s !== "bot_stop" && !s.startsWith("voice_present")),
      [`voice_join ${ME}  ${SALA_1}`],
    );
  });

  test("a conexão com o banco fecha sozinha depois de ociosa (pool não segura o Neon acordado)", async () => {
    const fake = new FakeDiscord();
    await fake.start();
    const bot = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir: tempQueueDir() });
    const botConnections = async () =>
      Number(
        (
          await admin.query(
            "select count(*)::int as n from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() and datname = current_database()",
          )
        ).rows[0].n,
      );
    try {
      await bot.waitFor(/acesso=1 motivo=eventos/);
      assert.equal(await botConnections(), 1);
      await eventually(async () => (await botConnections()) === 0, 10_000);
      fake.emitVoice(ME, SALA_1);
      await bot.waitFor(/acesso=2 motivo=eventos/);
      await eventually(async () => (await botConnections()) === 0, 10_000);
    } finally {
      await bot.kill();
      await fake.stop();
    }
  });

  test("quem não consentiu não aparece na fila em disco nem na quarentena, mesmo com o banco fora", async () => {
    const hole = await blackhole();
    const queueDir = tempQueueDir();
    const fake = new FakeDiscord();
    await fake.start();
    fake.setVoice(OTHER, SALA_1);
    const bot = new BotProcess(fake, { databaseUrl: hole.url, queueDir });
    try {
      await bot.waitFor(/estado inicial: 0 da allowlist/);
      fake.emitVoice(OTHER, SALA_2);
      fake.emitVoice(ME, SALA_1);
      fake.emitVoice(OTHER, null);
      await bot.waitFor(/ entrou canal="Sala 1" /);
      bot.terminate();
      await bot.waitExit(8_000);
    } finally {
      await bot.kill();
      await hole.close();
      await fake.stop();
    }
    const text = queueText(queueDir);
    assert.ok(text.includes(ME), text);
    assert.ok(!text.includes(OTHER), "quem não consentiu apareceu na fila em disco");
    assert.ok(!bot.output.includes(OTHER), "quem não consentiu apareceu no log");
    assert.ok(!bot.output.includes("senha-falsa"), "a senha apareceu no log");
  });

  test("fila com linhas corrompidas, duplicada e cortada: o bot sobe, grava as boas na ordem e separa as ruins", async () => {
    const queueDir = tempQueueDir();
    const line = (key: string, at: string, to: string) =>
      JSON.stringify({
        idempotencyKey: key,
        eventType: "voice_join",
        guildId: GUILD,
        discordUserId: ME,
        fromChannelId: null,
        toChannelId: to,
        occurredAt: at,
      });
    writeFileSync(
      join(queueDir, PENDING_FILE),
      [
        line("00000000-0000-4000-8000-000000000001", "2026-11-09T10:00:00.000Z", SALA_1),
        "isto não é json",
        "null",
        "[]",
        JSON.stringify({ idempotencyKey: "00000000-0000-4000-8000-000000000009", eventType: "voice_join", occurredAt: "2026-11-09 10:00:00" }),
        line("00000000-0000-4000-8000-000000000002", "2026-11-09T10:01:00.000Z", SALA_2),
        line("00000000-0000-4000-8000-000000000001", "2026-11-09T10:00:00.000Z", SALA_1), // linha duplicada: mesma chave
        line("00000000-0000-4000-8000-000000000003", "2026-11-09T10:02:00.000Z", SALA_1).slice(0, 40), // escrita cortada
      ].join("\n"),
    );
    const fake = new FakeDiscord();
    await fake.start();
    const bot = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir });
    try {
      await bot.waitFor(/3 evento\(s\) pendente\(s\)/);
      await bot.waitFor(/5 linha\(s\) ilegível\(is\) separada\(s\) na quarentena/);
      await eventually(async () => pendingCount(queueDir) === 0);
      bot.terminate();
      await bot.waitExit(5_000);
    } finally {
      await bot.kill();
      await fake.stop();
    }
    const rows = await readRows(admin);
    assert.deepEqual(
      rows.filter((r) => r.idempotency_key.startsWith("00000000-0000-4000-8000-")).map((r) => r.idempotency_key),
      ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
    );
    assert.equal(rows[0]!.idempotency_key, "00000000-0000-4000-8000-000000000001", "eventos da execução anterior devem vir antes do bot_start novo");
    const quarantine = readFileSync(join(queueDir, QUARANTINE_FILE), "utf8").trim().split("\n");
    assert.equal(quarantine.length, 5);
  });

  test("morte por SIGKILL em pontos aleatórios, com o banco no ar: nenhum evento confirmado se perde, nada duplica, a ordem se mantém", async (t) => {
    const queueDir = tempQueueDir();
    const url = proxy.url(container);
    const child = fileURLToPath(new URL("./kill-loop-child.ts", import.meta.url));
    const confirmed: string[] = [];
    let seq = 0;
    for (let round = 0; round < 12; round += 1) {
      const proc = spawn(process.execPath, [child, queueDir, url, String(seq)], { stdio: ["ignore", "pipe", "inherit"] });
      let buffer = "";
      proc.stdout!.setEncoding("utf8");
      proc.stdout!.on("data", (chunk: string) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const p of parts) if (p.startsWith("ok ")) confirmed.push(p.slice(3));
      });
      await new Promise((r) => setTimeout(r, 1_500 + Math.floor(Math.random() * 1_500)));
      proc.kill("SIGKILL");
      await once(proc, "exit");
      seq = (round + 1) * 1_000_000;
    }
    // Rodada final sem morte: só esvazia a fila.
    const last = spawn(process.execPath, [child, queueDir, url, "drain"], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      await eventually(async () => pendingCount(queueDir) === 0, 30_000);
    } finally {
      last.kill("SIGKILL");
      await once(last, "exit");
    }

    const rows = await readRows(admin);
    t.diagnostic(`eventos confirmados: ${confirmed.length}; linhas no banco: ${rows.length}`);
    const keys = rows.map((r) => r.idempotency_key);
    assert.equal(new Set(keys).size, keys.length, "chave duplicada no banco");
    const inDb = new Set(keys);
    const lost = confirmed.filter((k) => !inDb.has(k));
    assert.deepEqual(lost, [], `${lost.length} de ${confirmed.length} eventos confirmados não chegaram ao banco`);
    const position = new Map(keys.map((k, i) => [k, i]));
    const order = confirmed.map((k) => position.get(k)!);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "ordem diferente da observada");
    assert.ok(confirmed.length > 100, `poucos eventos (${confirmed.length})`);
    const quarantine = join(queueDir, QUARANTINE_FILE);
    if (existsSync(quarantine)) {
      // Linha cortada pela morte no meio do append é aceitável só se não for de evento confirmado.
      const text = readFileSync(quarantine, "utf8");
      for (const k of confirmed) assert.ok(!text.includes(k), `evento confirmado ${k} foi para a quarentena`);
    }
  });
});
