// Roda o `index.ts` real, como processo filho, contra um Discord falso local (REST + gateway).
// Token falso, sem `.env` e sem rede externa. O banco é falso e derruba toda conexão: os eventos
// ficam na fila em disco (o teste com Postgres real está em test/bot.integration.test.ts).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  BotProcess,
  children,
  FAKE_TOKEN,
  ME,
  OTHER,
  SALA_1,
  SALA_2,
  refusingDatabaseUrl,
  startRefusingDatabase,
  tempQueueDir,
  until,
  withBot,
} from "./fake-discord.test-helper.ts";

before(() => startRefusingDatabase());

after(() => {
  for (const child of children) child.kill();
});

// Cada processo carrega discord.js e o Drizzle (cerca de 3 s de CPU): todos de uma vez estouram os prazos.
describe("index.ts contra o Discord falso", { concurrency: 4, timeout: 180_000 }, () => {
  test("pede as intents Guilds e GuildVoiceStates e lê quem já estava em call", () =>
    withBot(
      (fake) => {
        fake.setVoice(ME, SALA_1);
        fake.setVoice(OTHER, SALA_1);
      },
      async (bot, fake) => {
        await bot.waitFor(/^\[bot\] aviso: BOT_TEST_ALLOWLIST_USER_IDS: o item 2 tem 3 dígitos/);
        await bot.waitFor(/^\[bot\] conectado como "bot-falso"; servidores: 1\.$/);
        assert.equal(fake.intents, 1 | 128, "intents enviadas no IDENTIFY");
        await bot.waitFor(/ já estava canal="Sala 1" id=500000000000000501 usuario=100000000000000111$/);
        await bot.waitFor(/^\[bot\] estado inicial: 1 da allowlist em call\.$/);
        fake.emitVoice(ME, SALA_2);
        await bot.waitFor(/ trocou de="Sala 1" de_id=500000000000000501 para="Sala 2" para_id=500000000000000502 usuario=100000000000000111$/);
        assert.ok(!bot.output.includes(OTHER), "quem não está na allowlist apareceu");
      },
      { allowlist: `${ME},111` },
    ));

  test(".env com BOM: a primeira variável não se perde e o bot avisa", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bot-env-"));
    const envFile = join(dir, ".env");
    writeFileSync(envFile, `﻿DISCORD_BOT_TOKEN=${FAKE_TOKEN}
BOT_TEST_ALLOWLIST_USER_IDS=${ME}
BOT_DATABASE_URL=${refusingDatabaseUrl()}
`);
    try {
      await withBot(
        () => {},
        async (bot) => {
          await bot.waitFor(/^\[bot\] aviso: o \.env começa com BOM/);
          await bot.waitFor(/^\[bot\] conectado como "bot-falso"/);
        },
        { envFile },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("allowlist malformada impede a subida com o código de configuração (78), com mensagem clara", () =>
    withBot(
      () => {},
      async (bot) => {
        assert.equal(await bot.waitExit(), 78);
        assert.match(bot.output, /\[err\] \[bot\] erro: BOT_TEST_ALLOWLIST_USER_IDS malformado: o item 1 /);
      },
      { allowlist: `<@${ME}>` },
    ));

  test("erro do cliente imprime só o nome", () =>
    withBot(
      () => {},
      async (bot) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        bot.send("client-error");
        await bot.waitFor(/^\[bot\] erro do cliente: FakeClientError$/);
        bot.interrupt();
        await bot.waitExit();
        assert.ok(!bot.output.includes("SEGREDO-NA-MENSAGEM-DO-ERRO"), `a mensagem do erro vazou:\n${bot.output}`);
        assert.ok(!/\bat \S+:\d+/.test(bot.output), `a pilha do erro vazou:\n${bot.output}`);
      },
    ));

  test("Ctrl+C encerra com código 0 e sem linha falsa de queda", () =>
    withBot(
      (fake) => fake.setVoice(ME, SALA_1),
      async (bot) => {
        await bot.waitFor(/estado inicial: 1 da allowlist/);
        const before = bot.lines.length;
        bot.interrupt();
        assert.equal(await bot.waitExit(), 0);
        const afterStop = bot.lines.slice(before).map((line) => line.text);
        assert.deepEqual(afterStop, [], "o encerramento não deve logar nada");
      },
    ));

  // P1: com login ou reconexão pendentes, o primeiro Ctrl+C não encerrava o bot.
  const STOP_MS = 5_000;
  async function interruptCleanly(bot: BotProcess, signal: "SIGINT" | "SIGTERM" = "SIGINT"): Promise<void> {
    const before = bot.lines.length;
    if (signal === "SIGINT") bot.interrupt();
    else bot.terminate();
    assert.equal(await bot.waitExit(STOP_MS), 0);
    assert.deepEqual(bot.lines.slice(before), [], "o encerramento não deve logar nada");
  }

  test("Ctrl+C com o REST do login sem resposta encerra com código 0", () =>
    withBot(
      (fake) => (fake.hangRest = true),
      async (bot, fake) => {
        await until(() => fake.restRequests > 0);
        await interruptCleanly(bot);
      },
    ));

  test("SIGTERM (docker stop) com o Hello do primeiro login pendente encerra com código 0", () =>
    withBot(
      (fake) => (fake.withholdHello = true),
      async (bot, fake) => {
        await until(() => fake.connections > 0);
        await interruptCleanly(bot, "SIGTERM");
      },
    ));

  test("SIGTERM (docker stop) com o bot conectado encerra com código 0", () =>
    withBot(
      () => {},
      async (bot) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        await interruptCleanly(bot, "SIGTERM");
      },
    ));

  test("Ctrl+C com o Hello do primeiro login pendente encerra com código 0", () =>
    withBot(
      (fake) => (fake.withholdHello = true),
      async (bot, fake) => {
        await until(() => fake.connections > 0);
        await interruptCleanly(bot);
      },
    ));

  test("Ctrl+C com o READY do primeiro login pendente encerra com código 0", () =>
    withBot(
      (fake) => (fake.withholdReady = true),
      async (bot, fake) => {
        await until(() => fake.identifies > 0);
        await interruptCleanly(bot);
      },
    ));

  test("Ctrl+C durante a reconexão com Hello pendente encerra com código 0", () =>
    withBot(
      () => {},
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        fake.withholdHello = true;
        fake.cut({ invalidate: true });
        await bot.waitFor(/ queda detectada; reconectando/);
        await until(() => fake.connections > 1);
        await interruptCleanly(bot);
      },
    ));

  test("Ctrl+C durante a reconexão com READY pendente encerra com código 0", () =>
    withBot(
      () => {},
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        fake.withholdReady = true;
        fake.cut({ invalidate: true });
        await bot.waitFor(/ queda detectada; reconectando/);
        await until(() => fake.identifies > 1);
        await interruptCleanly(bot);
      },
    ));

  test("queda com resume: o evento perdido chega e a retomada é logada", () =>
    withBot(
      (fake) => fake.setVoice(ME, SALA_1),
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 1 da allowlist/);
        fake.cut();
        fake.emitVoice(ME, null);
        await bot.waitFor(/ queda detectada; reconectando/);
        await bot.waitFor(/ saiu canal="Sala 1" id=500000000000000501 usuario=100000000000000111 horario=chegada$/);
        await bot.waitFor(/ retomada modo=resume reenviados=\d+ tentativas=\d+ desde_deteccao_s=\d+$/);
        assert.equal(fake.identifies, 1, "resume não deve identificar de novo");
      },
    ));

  test("queda com nova sessão: o GUILD_CREATE reconcilia quem trocou de canal", () =>
    withBot(
      (fake) => fake.setVoice(ME, SALA_1),
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 1 da allowlist/);
        fake.setVoice(ME, SALA_2);
        fake.cut({ invalidate: true });
        await bot.waitFor(/ queda detectada; reconectando/);
        await bot.waitFor(/ trocou_na_queda de="Sala 1" de_id=500000000000000501 para="Sala 2" para_id=500000000000000502 usuario=100000000000000111 horario=deteccao$/);
        await bot.waitFor(/ retomada modo=identify /);
        assert.equal(fake.identifies, 2);
      },
    ));

  test("código 4004 (token recusado, sem reconexão) encerra o bot com o código de configuração (78)", () =>
    withBot(
      () => {},
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        fake.closeOnIdentify = 4004;
        fake.cut({ invalidate: true });
        await bot.waitFor(/encerrou a conexão sem permitir reconexão \(código: 4004\)/);
        assert.equal(await bot.waitExit(), 78);
      },
    ));

  test("código 4011 (sem reconexão, não é configuração) encerra o bot com código 1", () =>
    withBot(
      () => {},
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        fake.closeOnIdentify = 4011;
        fake.cut({ invalidate: true });
        await bot.waitFor(/encerrou a conexão sem permitir reconexão \(código: 4011\)/);
        assert.equal(await bot.waitExit(), 1);
      },
    ));

  // F0-12: erro de rede no login não derruba o bot; ele tenta de novo, com espera crescente.
  test("Discord fora no login (503): o bot não sai, espera 5 s e conecta quando o Discord volta", () =>
    withBot(
      (fake) => {
        fake.gatewayStatus = 503;
        fake.setVoice(ME, SALA_1);
      },
      async (bot, fake) => {
        await bot.waitFor(/^\[bot\] aviso: não foi possível conectar ao Discord \(código: HTTP_503\); tentativa 1; nova tentativa em 5 s\.$/);
        fake.gatewayStatus = null;
        await bot.waitFor(/^\[bot\] conectado como "bot-falso"; servidores: 1\.$/);
        await bot.waitFor(/^\[bot\] estado inicial: 1 da allowlist em call\.$/);
        // O login só resolve depois do READY: esta linha pode vir antes ou depois das de cima.
        await until(() => bot.lines.some((line) => line.text === "[bot] conectado ao Discord na tentativa 2."));
        fake.emitVoice(ME, SALA_2);
        await bot.waitFor(/ trocou de="Sala 1" de_id=500000000000000501 para="Sala 2" para_id=500000000000000502 usuario=100000000000000111$/);
        // Sem exigir silêncio: o aviso do banco falso pode chegar a qualquer momento.
        bot.terminate();
        assert.equal(await bot.waitExit(STOP_MS), 0);
      },
    ));

  test("SIGTERM (docker stop) durante a espera entre tentativas de login encerra com código 0, no prazo", () =>
    withBot(
      (fake) => (fake.gatewayStatus = 502),
      async (bot) => {
        await bot.waitFor(/tentativa 1; nova tentativa em 5 s\.$/);
        await interruptCleanly(bot, "SIGTERM");
      },
    ));

  test("token recusado no login (401): sai com o código de configuração (78), sem nova tentativa", () =>
    withBot(
      (fake) => (fake.gatewayStatus = 401),
      async (bot, fake) => {
        assert.equal(await bot.waitExit(), 78);
        assert.match(bot.output, /\[err\] \[bot\] erro: DISCORD_BOT_TOKEN inválido: o Discord recusou o login\./);
        assert.ok(!bot.output.includes("nova tentativa"), "token recusado não deve ser tentado de novo");
        assert.equal(fake.restRequests, 1);
      },
    ));

  test("banco fora: o bot segue, guarda os eventos na fila em disco e encerra no prazo, sem logar", async () => {
    const queueDir = tempQueueDir();
    await withBot(
      (fake) => {
        fake.setVoice(ME, SALA_1);
        fake.setVoice(OTHER, SALA_1);
      },
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 1 da allowlist/);
        await bot.waitFor(/^\[db\] \S+Z acesso=1 falhou \(código: (?:[A-Z0-9_]+|desconhecido)\); pendentes=2; nova tentativa em 5 s$/);
        fake.emitVoice(OTHER, SALA_2);
        fake.emitVoice(ME, SALA_2);
        await bot.waitFor(/ trocou de="Sala 1" de_id=500000000000000501 para="Sala 2" para_id=500000000000000502 usuario=100000000000000111$/);
        const before = bot.lines.length;
        const started = Date.now();
        bot.terminate();
        assert.equal(await bot.waitExit(5_000), 0);
        assert.ok(Date.now() - started < 4_000, `encerrou em ${Date.now() - started} ms`);
        assert.deepEqual(bot.lines.slice(before), [], "o encerramento não deve logar nada");
        assert.ok(!bot.output.includes(OTHER), "quem não consentiu apareceu no log");
        assert.ok(!bot.output.includes("senha-falsa"), "a URL do banco apareceu no log");
      },
      { queueDir },
    );
    const queued = readFileSync(join(queueDir, "pending.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { eventType: string; discordUserId: string | null });
    assert.deepEqual(
      queued.map((e) => e.eventType),
      ["bot_start", "voice_present", "voice_move", "bot_stop"],
    );
    assert.ok(queued.every((e) => e.discordUserId === null || e.discordUserId === ME), "quem não consentiu foi para a fila");
  });
});
