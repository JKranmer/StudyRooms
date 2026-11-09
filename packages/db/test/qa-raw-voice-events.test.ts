// Testes de QA (Theo) da F1-04 e F1-46: limites, fusos, concorrência e entradas hostis.
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  insertRawVoiceEvents,
  runMigrations,
  type Database,
  type NewRawVoiceEvent,
} from "../src/index.ts";
import { startPostgres } from "./postgres-container.ts";

const USER = "123456789012345678";
const GUILD = "234567890123456789";
const CHANNEL_A = "345678901234567890";

let container: StartedPostgreSqlContainer;
let client: pg.Client;
let db: Database;
let closeDb: (() => Promise<void>) | undefined;

beforeAll(async () => {
  container = await startPostgres();
  await runMigrations(container.getConnectionUri());
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  const handle = createDb(container.getConnectionUri());
  db = handle.db;
  closeDb = handle.close;
});

afterAll(async () => {
  await closeDb?.();
  await client?.end();
  await container?.stop();
});

beforeEach(async () => {
  await client.query("truncate raw_voice_events");
});

function join(overrides: Partial<NewRawVoiceEvent> = {}): NewRawVoiceEvent {
  return {
    idempotencyKey: crypto.randomUUID(),
    eventType: "voice_join",
    discordUserId: USER,
    guildId: GUILD,
    toChannelId: CHANNEL_A,
    occurredAt: new Date("2026-11-09T12:00:00.000Z"),
    ...overrides,
  };
}

describe("snowflakes", () => {
  test.each([
    ["quebra de linha no fim", `${USER}\n`],
    ["espaço no fim", `${USER} `],
    ["dígitos não ASCII", "١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧"],
    ["16 dígitos", "1234567890123456"],
    ["21 dígitos", "123456789012345678901"],
    ["vazio", ""],
  ])("recusa ID com %s", async (_name, id) => {
    await expect(insertRawVoiceEvents(db, [join({ discordUserId: id })])).rejects.toThrow();
  });

  test("aceita 17 e 20 dígitos e preserva o valor acima de 2^53", async () => {
    const big = "18446744073709551615";
    await insertRawVoiceEvents(db, [join({ discordUserId: "10000000000000000" }), join({ discordUserId: big })]);
    const { rows } = await client.query<{ id: string }>("select discord_user_id as id from raw_voice_events order by 1");
    expect(rows.map((r) => r.id)).toEqual(["10000000000000000", big]);
  });
});

describe("tempo", () => {
  test("occurred_at é o mesmo instante, qualquer que seja o fuso da sessão de quem grava", async () => {
    const instant = new Date("2026-03-08T07:30:00.123Z"); // perto da virada do horário de verão nos EUA
    const sp = createDb(container.getConnectionUri(), { sessionTimeZone: "America/Sao_Paulo" });
    const ny = createDb(container.getConnectionUri(), { sessionTimeZone: "America/New_York" });
    try {
      await insertRawVoiceEvents(sp.db, [join({ occurredAt: instant })]);
      await insertRawVoiceEvents(ny.db, [join({ occurredAt: instant })]);
    } finally {
      await sp.close();
      await ny.close();
    }
    const { rows } = await client.query<{ ms: string }>(
      "select (extract(epoch from occurred_at) * 1000)::bigint::text as ms from raw_voice_events",
    );
    expect(rows.map((r) => r.ms)).toEqual([String(instant.getTime()), String(instant.getTime())]);
  });

  test("a sessão padrão do createDb está em UTC", async () => {
    const { rows } = await db.execute<{ tz: string }>(sql`select current_setting('TimeZone') as tz`);
    expect(rows[0]?.tz).toBe("UTC");
  });

  test("recusa data inválida", async () => {
    await expect(insertRawVoiceEvents(db, [join({ occurredAt: new Date(Number.NaN) })])).rejects.toThrow();
  });

  test("createDb recusa fuso que tente injetar outra opção", () => {
    expect(() => createDb("postgres://x@localhost/x", { sessionTimeZone: "UTC -c statement_timeout=1" })).toThrow();
  });
});

describe("idempotência sob concorrência", () => {
  test("dois gravadores simultâneos com a mesma chave deixam uma linha", async () => {
    const event = join();
    const other = createDb(container.getConnectionUri());
    try {
      const results = await Promise.all([
        insertRawVoiceEvents(db, [event]),
        insertRawVoiceEvents(other.db, [event]),
        insertRawVoiceEvents(db, [event]),
      ]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    } finally {
      await other.close();
    }
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from raw_voice_events");
    expect(rows[0]?.n).toBe(1);
  });

  test("lote com uma linha inválida não grava nenhuma (tudo ou nada)", async () => {
    await expect(insertRawVoiceEvents(db, [join(), join({ guildId: "x" })])).rejects.toThrow();
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from raw_voice_events");
    expect(rows[0]?.n).toBe(0);
  });

  test("lote grande, como a fila em disco depois de uma queda longa, é gravado inteiro", async () => {
    const events = Array.from({ length: 12_000 }, () => join());
    expect(await insertRawVoiceEvents(db, events)).toBe(12_000);
  });

  test.each([999, 1000, 1001, 2000, 2001])("lote de %i eventos, na fronteira dos blocos, grava todos", async (n) => {
    expect(await insertRawVoiceEvents(db, Array.from({ length: n }, () => join()))).toBe(n);
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from raw_voice_events");
    expect(rows[0]?.n).toBe(n);
  });

  test("chave repetida em blocos diferentes do mesmo lote grava uma vez e preserva a primeira", async () => {
    const first = join({ occurredAt: new Date("2026-01-01T00:00:00.000Z") });
    const events = Array.from({ length: 1500 }, () => join());
    events[0] = first;
    events[1400] = { ...first, occurredAt: new Date("2027-01-01T00:00:00.000Z") };
    expect(await insertRawVoiceEvents(db, events)).toBe(1499);
    const { rows } = await client.query<{ at: Date }>(
      "select occurred_at as at from raw_voice_events where idempotency_key = $1",
      [first.idempotencyKey],
    );
    expect(rows.map((r) => r.at.toISOString())).toEqual(["2026-01-01T00:00:00.000Z"]);
  });

  test("linha inválida no último bloco desfaz os blocos anteriores", async () => {
    const events = Array.from({ length: 2500 }, () => join());
    events[2499] = join({ guildId: "x" });
    await expect(insertRawVoiceEvents(db, events)).rejects.toThrow();
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from raw_voice_events");
    expect(rows[0]?.n).toBe(0);
  });

  test("reenviar um lote grande já gravado não duplica e devolve zero", async () => {
    const events = Array.from({ length: 3000 }, () => join());
    expect(await insertRawVoiceEvents(db, events)).toBe(3000);
    expect(await insertRawVoiceEvents(db, events)).toBe(0);
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from raw_voice_events");
    expect(rows[0]?.n).toBe(3000);
  });

  test("dois lotes grandes simultâneos com as mesmas chaves deixam uma linha por chave", async () => {
    const events = Array.from({ length: 2500 }, () => join());
    const other = createDb(container.getConnectionUri());
    try {
      const [a, b] = await Promise.all([insertRawVoiceEvents(db, events), insertRawVoiceEvents(other.db, events)]);
      expect(a + b).toBe(2500);
    } finally {
      await other.close();
    }
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from raw_voice_events");
    expect(rows[0]?.n).toBe(2500);
  });
});

describe("privacidade", () => {
  test("a tabela não tem coluna de mudo, transmissão, vídeo nem mensagem", async () => {
    const { rows } = await client.query<{ c: string }>(
      "select column_name as c from information_schema.columns where table_name = 'raw_voice_events'",
    );
    for (const { c } of rows) expect(c).not.toMatch(/mute|deaf|stream|video|message|content|self/i);
  });
});
