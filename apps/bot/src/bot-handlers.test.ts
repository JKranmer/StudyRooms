import assert from "node:assert/strict";
import { test } from "node:test";
import { createBotHandlers, type GuildView } from "./bot-handlers.ts";
import type { RawEventInput } from "./raw-event.ts";

const me = "111";
const other = "222";
const names: Record<string, string> = { a: "Sala A", b: "Sala B" };

function guild(states: Record<string, string | null> = {}, id = "g1"): GuildView {
  return {
    id,
    available: true,
    channelName: (channelId) => names[channelId] ?? null,
    voiceStates: () =>
      Object.entries(states).map(([userId, channelId]) => ({ userId, channelId })),
  };
}

function setup() {
  const lines: string[] = [];
  const records: RawEventInput[] = [];
  let ms = Date.parse("2026-11-07T01:30:00.000Z");
  const handlers = createBotHandlers({
    allowlist: new Set([me]),
    log: (line) => lines.push(line),
    now: () => new Date(ms),
    record: (event) => records.push(event),
  });
  return {
    handlers,
    lines,
    records,
    /** Resumo dos eventos gravados desde a última chamada: tipo, usuário, de, para e horário. */
    takeRecords: () =>
      records
        .splice(0)
        .map((e) =>
          [e.eventType, e.guildId, e.discordUserId, e.fromChannelId, e.toChannelId, e.occurredAt.toISOString()].join(" "),
        ),
    advance: (seconds: number) => {
      ms += seconds * 1000;
    },
    take: () => lines.splice(0),
  };
}

const T0 = "2026-11-07T01:30:00.000Z";

test("ao iniciar, loga quem da allowlist já está em call e ignora os demais", () => {
  const { handlers, take } = setup();
  handlers.onClientReady([guild({ [me]: "a", [other]: "b" })]);
  assert.deepEqual(take(), [
    `${T0} já estava canal="Sala A" id=a usuario=${me}`,
    "[bot] estado inicial: 1 da allowlist em call.",
  ]);
});

test("ao iniciar sem ninguém em call, diz isso em vez de ficar mudo", () => {
  const { handlers, take } = setup();
  handlers.onClientReady([guild({ [other]: "b" })]);
  assert.deepEqual(take(), ["[bot] estado inicial: 0 da allowlist em call."]);
});

test("servidor indisponível ao iniciar gera aviso e carrega quando ficar disponível", () => {
  const { handlers, take } = setup();
  handlers.onClientReady([{ ...guild({ [me]: "a" }), available: false }]);
  assert.deepEqual(take(), [
    "[bot] estado inicial: 0 da allowlist em call.",
    "[bot] aviso: 1 servidor(es) indisponível(is); o estado deles virá quando voltarem.",
  ]);
  handlers.onGuildAvailable(guild({ [me]: "a" }));
  assert.deepEqual(take(), [`${T0} já estava canal="Sala A" id=a usuario=${me}`]);
});

test("mudo sem estado em cache não gera entrou falso", () => {
  const { handlers, take } = setup();
  const unavailable = { ...guild(), available: false };
  handlers.onClientReady([unavailable]);
  take();
  handlers.onVoiceState(unavailable, me, "a");
  assert.deepEqual(take(), [
    `${T0} visto canal="Sala A" id=a usuario=${me} estado_anterior=desconhecido`,
  ]);
  handlers.onVoiceState(unavailable, me, "a");
  assert.deepEqual(take(), []);
});

test("guildAvailable antes do clientReady não duplica o estado inicial", () => {
  const { handlers, take } = setup();
  const g = guild({ [me]: "a" });
  handlers.onGuildAvailable(g);
  assert.deepEqual(take(), []);
  handlers.onClientReady([g]);
  assert.equal(take().length, 2);
});

test("entrada, troca e saída geram uma linha cada, com o usuário", () => {
  const { handlers, take } = setup();
  const g = guild();
  handlers.onClientReady([g]);
  take();
  handlers.onVoiceState(g, me, "a");
  handlers.onVoiceState(g, me, "a");
  handlers.onVoiceState(g, me, "b");
  handlers.onVoiceState(g, me, null);
  handlers.onVoiceState(g, other, "a");
  assert.deepEqual(take(), [
    `${T0} entrou canal="Sala A" id=a usuario=${me}`,
    `${T0} trocou de="Sala A" de_id=a para="Sala B" para_id=b usuario=${me}`,
    `${T0} saiu canal="Sala B" id=b usuario=${me}`,
  ]);
});

test("reconexões repetidas logam uma queda só e a retomada por resume", () => {
  const { handlers, take, advance } = setup();
  handlers.onClientReady([guild()]);
  take();
  handlers.onReconnecting();
  handlers.onReconnecting();
  handlers.onReconnecting();
  assert.deepEqual(take(), [
    `${T0} queda detectada; reconectando (horário da detecção, não da queda)`,
  ]);
  advance(12);
  handlers.onResume(3);
  assert.deepEqual(take(), [
    "2026-11-07T01:30:12.000Z retomada modo=resume reenviados=3 tentativas=3 desde_deteccao_s=12",
  ]);
});

test("evento recebido durante a reconexão marca que o horário é o de chegada", () => {
  const { handlers, take } = setup();
  const g = guild();
  handlers.onClientReady([g]);
  take();
  handlers.onReconnecting();
  take();
  handlers.onVoiceState(g, me, "a");
  assert.deepEqual(take(), [
    `${T0} entrou canal="Sala A" id=a usuario=${me} horario=chegada`,
  ]);
  handlers.onResume(1);
  take();
  handlers.onVoiceState(g, me, null);
  assert.deepEqual(take(), [`${T0} saiu canal="Sala A" id=a usuario=${me}`]);
});

test("nova sessão compara o estado e loga o que mudou durante a queda", () => {
  const { handlers, take, advance } = setup();
  handlers.onClientReady([guild({ [me]: "a" })]);
  take();
  handlers.onReconnecting();
  take();
  advance(60);
  handlers.onGuildAvailable(guild({}));
  handlers.onShardReady();
  const at = "2026-11-07T01:31:00.000Z";
  assert.deepEqual(take(), [
    `${at} saiu_na_queda canal="Sala A" id=a usuario=${me} horario=deteccao`,
    `${at} retomada modo=identify reenviados=0 tentativas=1 desde_deteccao_s=60`,
  ]);
});

test("nova sessão loga quem entrou, trocou e continua", () => {
  const { handlers, take } = setup();
  handlers.onClientReady([guild(), guild({ [me]: "a" }, "g2"), guild({ [me]: "a" }, "g3")]);
  take();
  handlers.onReconnecting();
  take();
  handlers.onGuildAvailable(guild({ [me]: "a" }));
  handlers.onGuildAvailable(guild({ [me]: "b" }, "g2"));
  handlers.onGuildAvailable(guild({ [me]: "a" }, "g3"));
  assert.deepEqual(take(), [
    `${T0} entrou_na_queda canal="Sala A" id=a usuario=${me} horario=deteccao`,
    `${T0} trocou_na_queda de="Sala A" de_id=a para="Sala B" para_id=b usuario=${me} horario=deteccao`,
    `${T0} continua canal="Sala A" id=a usuario=${me}`,
  ]);
});

test("shardReady sem queda em andamento não loga retomada", () => {
  const { handlers, take } = setup();
  handlers.onShardReady();
  assert.deepEqual(take(), []);
});

test("o mesmo erro de conexão é logado uma vez por queda, só com o código", () => {
  const { handlers, take } = setup();
  handlers.onClientReady([guild()]);
  take();
  handlers.onReconnecting();
  take();
  const withCode = Object.assign(new Error("segredo na mensagem"), { code: "ENOTFOUND" });
  handlers.onShardError(withCode);
  handlers.onShardError(withCode);
  handlers.onShardError(new Error("segredo na mensagem"));
  assert.deepEqual(take(), [
    "[bot] erro de conexão (código: ENOTFOUND).",
    "[bot] erro de conexão (código: Error).",
  ]);
  handlers.onResume(0);
  take();
  handlers.onReconnecting();
  take();
  handlers.onShardError({ code: "ENOTFOUND" });
  assert.deepEqual(take(), ["[bot] erro de conexão (código: ENOTFOUND)."]);
});

test("queda sem retorno é informada com o código de fechamento", () => {
  const { handlers, take } = setup();
  handlers.onDisconnect(4004);
  assert.deepEqual(take(), [
    "[bot] erro: o Discord encerrou a conexão sem permitir reconexão (código: 4004).",
  ]);
});

test("depois de parar, o fechamento da conexão não é logado como queda", () => {
  const { handlers, take } = setup();
  handlers.stop();
  handlers.onReconnecting();
  handlers.onDisconnect(1000);
  assert.deepEqual(take(), []);
});

test("nome de canal hostil não quebra a linha do estado inicial", () => {
  const { handlers, take } = setup();
  const g: GuildView = { ...guild({ [me]: "a" }), channelName: () => "x falso‮" };
  handlers.onClientReady([g]);
  assert.equal(take()[0], `${T0} já estava canal="x\\u2028falso\\u202e" id=a usuario=${me}`);
});

// F1-47: o que vai para o banco (D-30).
const T = T0;

test("ao iniciar, grava bot_start e voice_present só de quem consentiu", () => {
  const { handlers, takeRecords } = setup();
  handlers.onClientReady([guild({ [me]: "a", [other]: "b" })]);
  assert.deepEqual(takeRecords(), [`bot_start     ${T}`, `voice_present g1 ${me}  a ${T}`]);
});

test("entrada, troca e saída de quem consentiu viram eventos; os de outra pessoa, não", () => {
  const { handlers, takeRecords, lines } = setup();
  const g = guild();
  handlers.onClientReady([g]);
  takeRecords();
  handlers.onVoiceState(g, me, "a");
  handlers.onVoiceState(g, other, "a");
  handlers.onVoiceState(g, me, "b");
  handlers.onVoiceState(g, other, null);
  handlers.onVoiceState(g, me, null);
  assert.deepEqual(takeRecords(), [
    `voice_join g1 ${me}  a ${T}`,
    `voice_move g1 ${me} a b ${T}`,
    `voice_leave g1 ${me} b  ${T}`,
  ]);
  assert.ok(!lines.some((line) => line.includes(other)), "quem não consentiu apareceu no log");
});

test("mudo e transmissão (mesmo canal) não geram evento", () => {
  const { handlers, takeRecords } = setup();
  const g = guild({ [me]: "a" });
  handlers.onClientReady([g]);
  takeRecords();
  handlers.onVoiceState(g, me, "a");
  handlers.onVoiceState(g, me, "a");
  assert.deepEqual(takeRecords(), []);
});

test("queda e retomada geram bot_disconnect e bot_resume, e a reconciliação grava o que mudou", () => {
  const { handlers, takeRecords, advance } = setup();
  handlers.onClientReady([guild({ [me]: "a" })]);
  takeRecords();
  handlers.onReconnecting();
  handlers.onReconnecting();
  advance(60);
  const later = "2026-11-07T01:31:00.000Z";
  handlers.onGuildAvailable(guild({ [me]: "b" }));
  handlers.onShardReady();
  assert.deepEqual(takeRecords(), [
    `bot_disconnect     ${T}`,
    `voice_move g1 ${me} a b ${later}`,
    `bot_resume     ${later}`,
  ]);
});

test("reconciliação grava quem continua na call e quem saiu durante a queda", () => {
  const { handlers, takeRecords } = setup();
  handlers.onClientReady([guild({ [me]: "a" }, "g1"), guild({ [me]: "b" }, "g2")]);
  takeRecords();
  handlers.onReconnecting();
  handlers.onGuildAvailable(guild({ [me]: "a" }, "g1"));
  handlers.onGuildAvailable(guild({}, "g2"));
  handlers.onResume(0);
  assert.deepEqual(takeRecords(), [
    `bot_disconnect     ${T}`,
    `voice_present g1 ${me}  a ${T}`,
    `voice_leave g2 ${me} b  ${T}`,
    `bot_resume     ${T}`,
  ]);
});

test("servidor indisponível ao iniciar grava a presença quando ele chega", () => {
  const { handlers, takeRecords } = setup();
  handlers.onClientReady([{ ...guild({ [me]: "a" }), available: false }]);
  handlers.onGuildAvailable(guild({ [me]: "a" }));
  assert.deepEqual(takeRecords(), [`bot_start     ${T}`, `voice_present g1 ${me}  a ${T}`]);
});

test("stop grava bot_stop uma vez e, depois dele, nada mais é gravado", () => {
  const { handlers, takeRecords } = setup();
  const g = guild();
  handlers.onClientReady([g]);
  takeRecords();
  handlers.stop();
  handlers.stop();
  handlers.onVoiceState(g, me, "a");
  handlers.onReconnecting();
  assert.deepEqual(takeRecords(), [`bot_stop     ${T}`]);
});

test("stop antes de conectar não grava bot_stop (não houve bot_start)", () => {
  const { handlers, takeRecords } = setup();
  handlers.stop();
  assert.deepEqual(takeRecords(), []);
});
