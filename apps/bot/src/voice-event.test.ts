import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyVoiceEvent,
  formatVoiceLogLine,
  parseAllowlist,
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
