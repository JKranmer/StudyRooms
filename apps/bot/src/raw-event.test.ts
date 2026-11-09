import assert from "node:assert/strict";
import { test } from "node:test";
import {
  botMarker,
  eventFromChange,
  eventFromTransition,
  parseQueuedEvent,
  toQueuedEvent,
  toRow,
} from "./raw-event.ts";

const AT = new Date("2026-11-09T23:59:59.999Z");
const G = "900000000000000001";
const U = "100000000000000001";
const A = "500000000000000001";
const B = "500000000000000002";
const KEY = "0b6c3f0e-3c1b-4c55-9b6b-2a7f0f6d8e11";

test("entrada, saída e troca viram voice_join, voice_leave e voice_move", () => {
  assert.deepEqual(eventFromTransition(G, U, "join", null, A, AT), {
    eventType: "voice_join", guildId: G, discordUserId: U, fromChannelId: null, toChannelId: A, occurredAt: AT,
  });
  assert.deepEqual(eventFromTransition(G, U, "leave", A, null, AT), {
    eventType: "voice_leave", guildId: G, discordUserId: U, fromChannelId: A, toChannelId: null, occurredAt: AT,
  });
  assert.deepEqual(eventFromTransition(G, U, "move", A, B, AT), {
    eventType: "voice_move", guildId: G, discordUserId: U, fromChannelId: A, toChannelId: B, occurredAt: AT,
  });
});

test("visto sem estado anterior vira voice_present", () => {
  assert.equal(eventFromTransition(G, U, "seen", undefined, A, AT)?.eventType, "voice_present");
});

test("mudo, transmissão e quem não consentiu (ignore) não geram evento", () => {
  assert.equal(eventFromTransition(G, U, "ignore", A, A, AT), null);
});

test("reconciliação: já estava, continua e entrou na queda viram voice_present", () => {
  for (const kind of ["already", "still", "joined_gap"] as const) {
    assert.deepEqual(eventFromChange(G, { kind, userId: U, channelId: A }, AT), {
      eventType: "voice_present", guildId: G, discordUserId: U, fromChannelId: null, toChannelId: A, occurredAt: AT,
    });
  }
});

test("reconciliação: saiu e trocou na queda viram voice_leave e voice_move no horário da detecção", () => {
  assert.deepEqual(eventFromChange(G, { kind: "left_gap", userId: U, oldChannelId: A }, AT), {
    eventType: "voice_leave", guildId: G, discordUserId: U, fromChannelId: A, toChannelId: null, occurredAt: AT,
  });
  assert.deepEqual(eventFromChange(G, { kind: "moved_gap", userId: U, oldChannelId: A, channelId: B }, AT), {
    eventType: "voice_move", guildId: G, discordUserId: U, fromChannelId: A, toChannelId: B, occurredAt: AT,
  });
});

test("marcos do bot não têm usuário, servidor nem canal", () => {
  assert.deepEqual(botMarker("bot_heartbeat", AT), {
    eventType: "bot_heartbeat", guildId: null, discordUserId: null, fromChannelId: null, toChannelId: null, occurredAt: AT,
  });
});

test("o evento da fila guarda o horário em ISO UTC e volta igual", () => {
  const queued = toQueuedEvent(eventFromTransition(G, U, "move", A, B, AT)!, KEY);
  assert.equal(queued.occurredAt, "2026-11-09T23:59:59.999Z");
  const back = parseQueuedEvent(JSON.parse(JSON.stringify(queued)));
  assert.deepEqual(back, queued);
  assert.deepEqual(toRow(back!), {
    idempotencyKey: KEY,
    eventType: "voice_move",
    guildId: G,
    discordUserId: U,
    fromChannelId: A,
    toChannelId: B,
    occurredAt: AT,
  });
});

test("linha da fila com forma inesperada é recusada na leitura", () => {
  const good = toQueuedEvent(botMarker("bot_start", AT), KEY);
  assert.ok(parseQueuedEvent(good));
  for (const bad of [
    null,
    "texto",
    { ...good, idempotencyKey: 1 },
    { ...good, eventType: "voice_mute" },
    { ...good, occurredAt: "ontem" },
    { ...good, occurredAt: "2026-11-09T23:59:59.999" },
    { ...good, guildId: 5 },
  ]) {
    assert.equal(parseQueuedEvent(bad), null, JSON.stringify(bad));
  }
});
