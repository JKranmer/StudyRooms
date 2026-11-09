import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyVoiceEvent,
  formatVoiceLogLine,
  parseAllowlist,
  quoteForLog,
} from "./voice-event.ts";

const allowlist = new Set(["111"]);
const base = { userId: "111", allowlist };

test("entrar em um canal é join", () => {
  assert.equal(
    classifyVoiceEvent({ ...base, oldChannelId: null, newChannelId: "a" }),
    "join",
  );
});

test("sair de um canal é leave", () => {
  assert.equal(
    classifyVoiceEvent({ ...base, oldChannelId: "a", newChannelId: null }),
    "leave",
  );
});

test("trocar de canal é move", () => {
  assert.equal(
    classifyVoiceEvent({ ...base, oldChannelId: "a", newChannelId: "b" }),
    "move",
  );
});

test("mudo ou transmissão, com o mesmo canal, é ignore", () => {
  assert.equal(
    classifyVoiceEvent({ ...base, oldChannelId: "a", newChannelId: "a" }),
    "ignore",
  );
});

test("sem canal antes e depois é ignore", () => {
  assert.equal(
    classifyVoiceEvent({ ...base, oldChannelId: null, newChannelId: null }),
    "ignore",
  );
});

test("quem está fora da allowlist é ignore em qualquer transição", () => {
  for (const [oldChannelId, newChannelId] of [
    [null, "a"],
    ["a", null],
    ["a", "b"],
  ] as const) {
    assert.equal(
      classifyVoiceEvent({ userId: "222", allowlist, oldChannelId, newChannelId }),
      "ignore",
    );
  }
});

test("allowlist vazia ignora todo mundo", () => {
  assert.equal(
    classifyVoiceEvent({
      userId: "111",
      allowlist: new Set(),
      oldChannelId: null,
      newChannelId: "a",
    }),
    "ignore",
  );
});

test("estado anterior desconhecido com canal é seen, nunca join", () => {
  assert.equal(
    classifyVoiceEvent({ ...base, oldChannelId: undefined, newChannelId: "a" }),
    "seen",
  );
});

test("estado anterior desconhecido sem canal é ignore", () => {
  assert.equal(
    classifyVoiceEvent({ ...base, oldChannelId: undefined, newChannelId: null }),
    "ignore",
  );
});

test("estado anterior desconhecido fora da allowlist é ignore", () => {
  assert.equal(
    classifyVoiceEvent({
      userId: "222",
      allowlist,
      oldChannelId: undefined,
      newChannelId: "a",
    }),
    "ignore",
  );
});

test("parseAllowlist separa por vírgula e descarta espaços e vazios", () => {
  assert.deepEqual([...parseAllowlist(" 111, 222,,")], ["111", "222"]);
  assert.deepEqual([...parseAllowlist(undefined)], []);
});

const at = new Date("2026-11-06T22:30:00.000-03:00");
const a = { id: "1", name: "Sala A" };
const b = { id: "2", name: "Sala B" };

test("a linha de entrada traz tipo, canal, id e horário UTC", () => {
  assert.equal(
    formatVoiceLogLine({ type: "join", at, newChannel: a }),
    '2026-11-07T01:30:00.000Z entrou canal="Sala A" id=1',
  );
});

test("a linha de saída traz o canal de origem", () => {
  assert.equal(
    formatVoiceLogLine({ type: "leave", at, oldChannel: a }),
    '2026-11-07T01:30:00.000Z saiu canal="Sala A" id=1',
  );
});

test("a linha de troca traz origem e destino", () => {
  assert.equal(
    formatVoiceLogLine({ type: "move", at, oldChannel: a, newChannel: b }),
    '2026-11-07T01:30:00.000Z trocou de="Sala A" de_id=1 para="Sala B" para_id=2',
  );
});

test("nome de canal desconhecido não quebra a linha", () => {
  assert.equal(
    formatVoiceLogLine({ type: "join", at, newChannel: { id: "1", name: null } }),
    '2026-11-07T01:30:00.000Z entrou canal=null id=1',
  );
});

test("a linha traz o usuário no fim, quando informado", () => {
  assert.equal(
    formatVoiceLogLine({ type: "join", at, newChannel: a, userId: "111" }),
    '2026-11-07T01:30:00.000Z entrou canal="Sala A" id=1 usuario=111',
  );
});

test("já estava é distinto dos eventos e traz canal, horário e usuário", () => {
  assert.equal(
    formatVoiceLogLine({ type: "already", at, newChannel: a, userId: "111" }),
    '2026-11-07T01:30:00.000Z já estava canal="Sala A" id=1 usuario=111',
  );
});

test("os tipos da queda deixam claro que o horário é o da detecção", () => {
  const userId = "111";
  assert.equal(
    formatVoiceLogLine({ type: "joined_gap", at, newChannel: a, userId }),
    '2026-11-07T01:30:00.000Z entrou_na_queda canal="Sala A" id=1 usuario=111 horario=deteccao',
  );
  assert.equal(
    formatVoiceLogLine({ type: "left_gap", at, oldChannel: a, userId }),
    '2026-11-07T01:30:00.000Z saiu_na_queda canal="Sala A" id=1 usuario=111 horario=deteccao',
  );
  assert.equal(
    formatVoiceLogLine({ type: "moved_gap", at, oldChannel: a, newChannel: b, userId }),
    '2026-11-07T01:30:00.000Z trocou_na_queda de="Sala A" de_id=1 para="Sala B" para_id=2 usuario=111 horario=deteccao',
  );
});

test("evento marcado como reenviado informa que o horário é o de chegada", () => {
  assert.equal(
    formatVoiceLogLine({ type: "leave", at, oldChannel: a, userId: "111", arrival: true }),
    '2026-11-07T01:30:00.000Z saiu canal="Sala A" id=1 usuario=111 horario=chegada',
  );
});

test("visto informa que o estado anterior é desconhecido", () => {
  assert.equal(
    formatVoiceLogLine({ type: "seen", at, newChannel: a, userId: "111" }),
    '2026-11-07T01:30:00.000Z visto canal="Sala A" id=1 usuario=111 estado_anterior=desconhecido',
  );
});

test("quoteForLog escapa o que quebra ou disfarça a linha do log", () => {
  const hostile: Array<[string, string]> = [
    [" ", "\\u2028"],
    [" ", "\\u2029"],
    ["\u0085", "\\u0085"],
    ["\u009b", "\\u009b"],
    ["‮", "\\u202e"],
    ["⁦", "\\u2066"],
    ["‎", "\\u200e"],
    ["؜", "\\u061c"],
    ["\u007f", "\\u007f"],
    ["﻿", "\\ufeff"],
    ["\u{e0041}", "\\udb40\\udc41"],
  ];
  for (const [raw, escaped] of hostile) {
    assert.equal(quoteForLog(`a${raw}b`), `"a${escaped}b"`);
  }
});

test("quoteForLog mantém o escape do JSON", () => {
  assert.equal(quoteForLog('a"\\\n\u001b[31m'), '"a\\"\\\\\\n\\u001b[31m"');
  assert.equal(quoteForLog(null), "null");
});

test("quoteForLog mantém acentos e emoji composto", () => {
  const name = "Matemática 👩‍💻 ❤️ 🇧🇷";
  assert.equal(quoteForLog(name), `"${name}"`);
});

test("a saída de quoteForLog continua sendo JSON que devolve o nome original", () => {
  const name = "x y‮z\u{e0041}";
  assert.equal(JSON.parse(quoteForLog(name)), name);
});

test("a linha formatada não tem separador nem caractere de controle cru", () => {
  const hostile = { id: "1", name: "x  \u0085\u009b‮\n\r\u001b" };
  const line = formatVoiceLogLine({ type: "join", at, newChannel: hostile });
  assert.doesNotMatch(line, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
});
