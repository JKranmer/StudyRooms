// O `index.ts` real, contra o Discord falso e um Postgres real (Testcontainers), ligado por um
// proxy que simula o banco fora do ar. Precisa do Docker ligado.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
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
import { eventually, proxyFor, readRows, startPostgres, type Row, type TcpProxy } from "./support.ts";

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

function summary(rows: Row[]): string[] {
  return rows.map((r) => [r.event_type, r.discord_user_id, r.guild_id, r.from_channel_id, r.to_channel_id].join(" ").trim());
}

async function rowCount(): Promise<number> {
  return (await readRows(admin)).length;
}

describe("bot com Postgres real", { concurrency: 1, timeout: 180_000 }, () => {
  test("grava só quem consentiu; mudo e transmissão não geram linha; nada de quem não consentiu no banco nem no log", async () => {
    const fake = new FakeDiscord();
    await fake.start();
    fake.setVoice(OTHER, SALA_1);
    const bot = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir: tempQueueDir() });
    try {
      await bot.waitFor(/estado inicial: 0 da allowlist/);
      fake.emitVoice(ME, SALA_1);
      fake.emitVoice(OTHER, SALA_2);
      fake.emitVoice(ME, SALA_1); // mudo, transmissão ou câmera: mesmo canal
      fake.emitVoice(ME, SALA_2);
      fake.emitVoice(OTHER, null);
      fake.emitVoice(ME, null);
      await bot.waitFor(/ saiu canal="Sala 2" /);
      await eventually(async () => (await rowCount()) >= 4);
      const started = Date.now();
      bot.terminate();
      assert.equal(await bot.waitExit(5_000), 0);
      assert.ok(Date.now() - started < 4_000, `encerrou em ${Date.now() - started} ms`);
      const rows = await readRows(admin);
      assert.deepEqual(summary(rows), [
        "bot_start",
        `voice_join ${ME} ${GUILD}  ${SALA_1}`,
        `voice_move ${ME} ${GUILD} ${SALA_1} ${SALA_2}`,
        `voice_leave ${ME} ${GUILD} ${SALA_2}`,
        "bot_stop",
      ]);
      assert.ok(!bot.output.includes(OTHER), "quem não consentiu apareceu no log");
      assert.ok(!bot.output.includes(container.getPassword()), "a senha do banco apareceu no log");
      assert.match(bot.output, /\[db\] \S+Z acesso=\d+ motivo=eventos gravados=\d+ novos=\d+ pendentes=\d+/);
    } finally {
      await bot.kill();
      await fake.stop();
    }
  });

  test("banco fora e bot morto com a fila cheia: ao religar, grava tudo, na ordem e sem duplicar", async () => {
    const queueDir = tempQueueDir();
    const fake = new FakeDiscord();
    await fake.start();
    fake.setVoice(ME, SALA_1);
    await proxy.down();
    const first = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir });
    try {
      await first.waitFor(/estado inicial: 1 da allowlist/);
      await first.waitFor(/\[db\] \S+Z acesso=1 falhou \(código: /);
      fake.emitVoice(ME, SALA_2);
      await first.waitFor(/ trocou de="Sala 1" /);
      fake.emitVoice(ME, null);
      await first.waitFor(/ saiu canal="Sala 2" /);
      await first.forceKill();
    } finally {
      await first.kill();
    }
    assert.equal(await rowCount(), 0);

    await proxy.up();
    fake.setVoice(ME, SALA_1);
    const second = new BotProcess(fake, { databaseUrl: proxy.url(container), queueDir });
    try {
      await second.waitFor(/^\[fila\] 4 evento\(s\) pendente\(s\) de uma execução anterior\.$/);
      await second.waitFor(/estado inicial: 1 da allowlist/);
      await eventually(async () => (await rowCount()) >= 6);
      second.terminate();
      assert.equal(await second.waitExit(5_000), 0);
    } finally {
      await second.kill();
      await fake.stop();
    }
    const rows = await readRows(admin);
    assert.deepEqual(summary(rows), [
      "bot_start",
      `voice_present ${ME} ${GUILD}  ${SALA_1}`,
      `voice_move ${ME} ${GUILD} ${SALA_1} ${SALA_2}`,
      `voice_leave ${ME} ${GUILD} ${SALA_2}`,
      "bot_start",
      `voice_present ${ME} ${GUILD}  ${SALA_1}`,
      "bot_stop",
    ]);
    assert.equal(new Set(rows.map((r) => r.idempotency_key)).size, rows.length);
  });
});
