// F0-06 (QA): limites da janela do resumo num Postgres real, com o papel só leitura do backup.
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { createDb, insertRawVoiceEvents, runMigrations, setupRoles, type NewRawVoiceEvent } from "../src/index.ts";
import { formatEventSummary, summarizeEvents } from "../src/event-summary.ts";
import { startPostgres } from "./postgres-container.ts";

const USER = "987654321098765432";
const GUILD = "876543210987654321";
const CH = "765432109876543210";
const NOW = new Date("2026-03-08T07:30:00Z"); // perto da virada do horário de verão nos EUA; o banco é UTC

let container: StartedPostgreSqlContainer;
let backupUrl: string;

const at = (ms: number) => new Date(NOW.getTime() + ms);
const H = 3_600_000;

function event(type: NewRawVoiceEvent["eventType"], when: Date, extra: Partial<NewRawVoiceEvent> = {}): NewRawVoiceEvent {
  return { idempotencyKey: crypto.randomUUID(), eventType: type, occurredAt: when, ...extra };
}

beforeAll(async () => {
  container = await startPostgres();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  // Sessão com fuso não UTC: o resultado não pode depender dele.
  await admin.query("create role neondb_owner login createrole password 'owner'");
  await admin.query("create database neondb owner neondb_owner");
  await admin.query("alter database neondb set timezone to 'America/Sao_Paulo'");
  await admin.end();
  const url = new URL(container.getConnectionUri());
  url.username = "neondb_owner";
  url.password = "owner";
  url.pathname = "/neondb";
  const ownerUrl = url.toString();
  await runMigrations(ownerUrl);
  const roles = await setupRoles(ownerUrl, { rotate: true, passwordFormat: "plaintext" });
  const backup = new URL(ownerUrl);
  backup.username = "studyrooms_backup";
  backup.password = roles.passwords.backup!;
  backupUrl = backup.toString();

  const { db, close } = createDb(ownerUrl);
  await insertRawVoiceEvents(db, [
    event("voice_join", at(-1 * H), { discordUserId: USER, guildId: GUILD, toChannelId: CH }), // exatamente no início: fora
    event("voice_join", at(-1 * H + 1), { discordUserId: USER, guildId: GUILD, toChannelId: CH }), // 1 ms depois: dentro
    event("voice_leave", at(0), { discordUserId: USER, guildId: GUILD, fromChannelId: CH }), // exatamente agora: dentro
    event("voice_leave", at(1), { discordUserId: USER, guildId: GUILD, fromChannelId: CH }), // futuro: fora
    event("bot_heartbeat", at(-0.5 * H)),
  ]);
  await close();
});

afterAll(async () => {
  await container?.stop();
});

test("janela aberta no início e fechada no fim, em UTC, mesmo com o banco em outro fuso", async () => {
  const summary = await summarizeEvents(backupUrl, { hours: 1, now: NOW });
  const counts = Object.fromEntries(summary.byType.map((row) => [row.eventType, row.count]));
  expect(counts).toEqual({ voice_join: 1, voice_leave: 1, bot_heartbeat: 1 });
  expect(summary.byType.find((r) => r.eventType === "voice_leave")?.lastOccurredAt).toEqual(NOW);
  expect(summary.distinctUsers).toBe(1);
});

test("só eventos sem pessoa (heartbeat) contam 0 pessoas distintas", async () => {
  const summary = await summarizeEvents(backupUrl, { hours: 1, now: at(-0.25 * H) });
  expect(summary.byType.map((r) => r.eventType)).toEqual(["bot_heartbeat", "voice_join"]);
  const only = await summarizeEvents(backupUrl, { hours: 0.1, now: at(-0.45 * H) });
  expect(only.byType).toEqual([{ eventType: "bot_heartbeat", count: 1, lastOccurredAt: at(-0.5 * H) }]);
  expect(only.distinctUsers).toBe(0);
});

test("o texto final não tem nenhum ID do Discord", async () => {
  const lines = formatEventSummary(await summarizeEvents(backupUrl, { hours: 720, now: at(H) }), 720);
  const text = lines.join("\n");
  for (const id of [USER, GUILD, CH]) expect(text).not.toContain(id);
  expect(text).toContain("Pessoas distintas: 1.");
});

test("o papel do backup não consegue gravar: o resumo roda com conexão só leitura", async () => {
  const client = new pg.Client({ connectionString: backupUrl });
  await client.connect();
  try {
    await expect(
      client.query("insert into raw_voice_events (idempotency_key, event_type, occurred_at) values ($1, 'bot_start', now())", [
        crypto.randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(25006|42501)$/) }); // sessão só leitura ou sem permissão
  } finally {
    await client.end();
  }
});
