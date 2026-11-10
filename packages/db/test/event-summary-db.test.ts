// F0-06/F1-49: a consulta do resumo, num Postgres real, com o papel só leitura do backup.
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { createDb, insertRawVoiceEvents, runMigrations, setupRoles, type NewRawVoiceEvent } from "../src/index.ts";
import { summarizeEvents } from "../src/event-summary.ts";
import { startPostgres } from "./postgres-container.ts";

const USER_A = "123456789012345678";
const USER_B = "223456789012345678";
const GUILD = "234567890123456789";
const CH1 = "345678901234567890";
const CH2 = "445678901234567890";
const NOW = new Date("2026-11-10T12:00:00Z");

let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let backupUrl: string;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function event(type: NewRawVoiceEvent["eventType"], at: Date, extra: Partial<NewRawVoiceEvent> = {}): NewRawVoiceEvent {
  return { idempotencyKey: crypto.randomUUID(), eventType: type, occurredAt: at, ...extra };
}

beforeAll(async () => {
  container = await startPostgres();
  // Dono sem superusuário, só com CREATEROLE, como o neondb_owner (o mesmo arranjo de neon-roles.test.ts).
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("create role neondb_owner login createrole password 'owner'");
  await admin.query("create database neondb owner neondb_owner");
  await admin.end();
  const url = new URL(container.getConnectionUri());
  url.username = "neondb_owner";
  url.password = "owner";
  url.pathname = "/neondb";
  ownerUrl = url.toString();
  await runMigrations(ownerUrl);
  const roles = await setupRoles(ownerUrl, { rotate: true, passwordFormat: "plaintext" });
  const backup = new URL(ownerUrl);
  backup.username = "studyrooms_backup";
  backup.password = roles.passwords.backup!;
  backupUrl = backup.toString();

  const { db, close } = createDb(ownerUrl);
  await insertRawVoiceEvents(db, [
    event("voice_join", hoursAgo(2), { discordUserId: USER_A, guildId: GUILD, toChannelId: CH1 }),
    event("voice_move", hoursAgo(1.5), { discordUserId: USER_A, guildId: GUILD, fromChannelId: CH1, toChannelId: CH2 }),
    event("voice_leave", hoursAgo(1), { discordUserId: USER_A, guildId: GUILD, fromChannelId: CH2 }),
    event("voice_join", hoursAgo(0.5), { discordUserId: USER_B, guildId: GUILD, toChannelId: CH1 }),
    event("bot_heartbeat", hoursAgo(0.25), { guildId: null }),
    // Fora da janela de 24 h.
    event("voice_join", hoursAgo(30), { discordUserId: USER_A, guildId: GUILD, toChannelId: CH1 }),
  ]);
  await close();
});

afterAll(async () => {
  await container?.stop();
});

test("conta por tipo dentro da janela, com o último horário de cada tipo e pessoas distintas", async () => {
  const summary = await summarizeEvents(backupUrl, { hours: 24, now: NOW });
  const byType = Object.fromEntries(summary.byType.map((row) => [row.eventType, row]));
  expect(byType.voice_join).toEqual({ eventType: "voice_join", count: 2, lastOccurredAt: hoursAgo(0.5) });
  expect(byType.voice_move?.count).toBe(1);
  expect(byType.voice_leave?.count).toBe(1);
  expect(byType.bot_heartbeat?.count).toBe(1);
  expect(summary.distinctUsers).toBe(2);
  expect(summary.lastRecordedAt).toBeInstanceOf(Date);
});

test("a janela maior inclui o evento antigo", async () => {
  const summary = await summarizeEvents(backupUrl, { hours: 48, now: NOW });
  expect(summary.byType.find((row) => row.eventType === "voice_join")?.count).toBe(3);
});

test("nada no período devolve resumo vazio", async () => {
  const summary = await summarizeEvents(backupUrl, { hours: 1, now: hoursAgo(-100) });
  expect(summary).toEqual({ byType: [], distinctUsers: 0, lastRecordedAt: null });
});

test("o resultado não tem IDs do Discord", async () => {
  const text = JSON.stringify(await summarizeEvents(backupUrl, { hours: 48, now: NOW }));
  for (const id of [USER_A, USER_B, GUILD, CH1, CH2]) expect(text).not.toContain(id);
});
