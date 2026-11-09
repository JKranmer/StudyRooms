import assert from "node:assert/strict";
import { test } from "node:test";
import { VoicePresence } from "./presence.ts";

const me = "111";
const other = "222";
const guild = "g1";

function presence(): VoicePresence {
  return new VoicePresence(new Set([me]));
}

function loaded(channelId: string | null = null): VoicePresence {
  const p = presence();
  p.reconcile(guild, channelId ? [{ userId: me, channelId }] : []);
  return p;
}

test("o estado inicial marca como já estava só quem está na allowlist", () => {
  const changes = presence().reconcile(guild, [
    { userId: me, channelId: "a" },
    { userId: other, channelId: "a" },
  ]);
  assert.deepEqual(changes, [{ kind: "already", userId: me, channelId: "a" }]);
});

test("voice state em cache sem canal não conta como presença", () => {
  assert.deepEqual(presence().reconcile(guild, [{ userId: me, channelId: null }]), []);
});

test("quem não estava no estado inicial e chega ao canal entrou", () => {
  assert.deepEqual(loaded().observe(guild, me, "a"), {
    type: "join",
    oldChannelId: null,
    newChannelId: "a",
  });
});

test("mudo de quem já estava no estado inicial não vira entrada", () => {
  assert.equal(loaded("a").observe(guild, me, "a").type, "ignore");
});

test("sem estado inicial carregado, o primeiro evento em canal é visto, não entrou", () => {
  assert.deepEqual(presence().observe(guild, me, "a"), {
    type: "seen",
    oldChannelId: undefined,
    newChannelId: "a",
  });
});

test("sem estado inicial, o segundo evento no mesmo canal é ignorado", () => {
  const p = presence();
  p.observe(guild, me, "a");
  assert.equal(p.observe(guild, me, "a").type, "ignore");
});

test("sem estado inicial, sair de canal já visto é saída", () => {
  const p = presence();
  p.observe(guild, me, "a");
  assert.deepEqual(p.observe(guild, me, null), {
    type: "leave",
    oldChannelId: "a",
    newChannelId: null,
  });
});

test("sem estado inicial, evento sem canal não gera nada", () => {
  assert.equal(presence().observe(guild, me, null).type, "ignore");
});

test("troca e saída usam o estado acompanhado", () => {
  const p = loaded("a");
  assert.deepEqual(p.observe(guild, me, "b"), {
    type: "move",
    oldChannelId: "a",
    newChannelId: "b",
  });
  assert.equal(p.observe(guild, me, null).type, "leave");
  assert.equal(p.observe(guild, me, null).type, "ignore");
});

test("quem está fora da allowlist é ignorado e não fica guardado", () => {
  const p = loaded();
  assert.equal(p.observe(guild, other, "a").type, "ignore");
  assert.deepEqual(p.reconcile(guild, []), []);
});

test("cada servidor tem estado próprio", () => {
  const p = loaded("a");
  assert.equal(p.observe("g2", me, "x").type, "seen");
  p.reconcile("g2", []);
  assert.equal(p.observe("g2", me, "x").type, "join");
  assert.equal(p.observe(guild, me, "a").type, "ignore");
});

test("na ressincronização, sumir do canal é saída durante a queda", () => {
  assert.deepEqual(loaded("a").reconcile(guild, []), [
    { kind: "left_gap", userId: me, oldChannelId: "a" },
  ]);
});

test("na ressincronização, aparecer em canal é entrada durante a queda", () => {
  assert.deepEqual(loaded().reconcile(guild, [{ userId: me, channelId: "a" }]), [
    { kind: "joined_gap", userId: me, channelId: "a" },
  ]);
});

test("na ressincronização, outro canal é troca durante a queda", () => {
  assert.deepEqual(loaded("a").reconcile(guild, [{ userId: me, channelId: "b" }]), [
    { kind: "moved_gap", userId: me, oldChannelId: "a", channelId: "b" },
  ]);
});

test("na ressincronização, o mesmo canal é continua, e o estado segue valendo", () => {
  const p = loaded("a");
  assert.deepEqual(p.reconcile(guild, [{ userId: me, channelId: "a" }]), [
    { kind: "still", userId: me, channelId: "a" },
  ]);
  assert.equal(p.observe(guild, me, "a").type, "ignore");
});

test("depois da ressincronização, o estado novo substitui o antigo", () => {
  const p = loaded("a");
  p.reconcile(guild, []);
  assert.equal(p.observe(guild, me, "a").type, "join");
});
