import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  INSERT_CHUNK_SIZE,
  insertRawVoiceEvents,
  runMigrations,
  type Database,
  type NewRawVoiceEvent,
} from "../src/index.ts";
import { startPostgres } from "./postgres-container.ts";

const USER = "123456789012345678";
const GUILD = "234567890123456789";
const CHANNEL_A = "345678901234567890";
const CHANNEL_B = "456789012345678901";

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
    occurredAt: new Date("2026-11-09T23:59:59.500Z"),
    ...overrides,
  };
}

function botMarker(eventType: NewRawVoiceEvent["eventType"]): NewRawVoiceEvent {
  return { idempotencyKey: crypto.randomUUID(), eventType, occurredAt: new Date() };
}

describe("colunas", () => {
  test("guarda só o fato: sem mudo, transmissão ou mensagem", async () => {
    const { rows } = await client.query(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'raw_voice_events' order by column_name`,
    );
    expect(rows).toEqual([
      { column_name: "discord_user_id", data_type: "text", is_nullable: "YES" },
      { column_name: "event_type", data_type: "text", is_nullable: "NO" },
      { column_name: "from_channel_id", data_type: "text", is_nullable: "YES" },
      { column_name: "guild_id", data_type: "text", is_nullable: "YES" },
      { column_name: "id", data_type: "bigint", is_nullable: "NO" },
      { column_name: "idempotency_key", data_type: "uuid", is_nullable: "NO" },
      { column_name: "occurred_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "recorded_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "to_channel_id", data_type: "text", is_nullable: "YES" },
    ]);
  });
});

describe("gravação", () => {
  test("entrada, troca e saída ficam gravadas com IDs, canais e horário em UTC", async () => {
    const inserted = await insertRawVoiceEvents(db, [
      join({ occurredAt: new Date("2026-11-09T21:00:00-03:00") }),
      join({
        eventType: "voice_move",
        fromChannelId: CHANNEL_A,
        toChannelId: CHANNEL_B,
        occurredAt: new Date("2026-11-09T21:59:59.999-03:00"),
      }),
      join({
        eventType: "voice_leave",
        fromChannelId: CHANNEL_B,
        toChannelId: null,
        occurredAt: new Date("2026-11-10T01:00:00.001Z"),
      }),
    ]);
    expect(inserted).toBe(3);

    const { rows } = await client.query(
      `select event_type, discord_user_id, guild_id, from_channel_id, to_channel_id,
              to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') as occurred_utc
         from raw_voice_events order by occurred_at`,
    );
    expect(rows).toEqual([
      {
        event_type: "voice_join",
        discord_user_id: USER,
        guild_id: GUILD,
        from_channel_id: null,
        to_channel_id: CHANNEL_A,
        occurred_utc: "2026-11-10T00:00:00.000",
      },
      {
        event_type: "voice_move",
        discord_user_id: USER,
        guild_id: GUILD,
        from_channel_id: CHANNEL_A,
        to_channel_id: CHANNEL_B,
        occurred_utc: "2026-11-10T00:59:59.999",
      },
      {
        event_type: "voice_leave",
        discord_user_id: USER,
        guild_id: GUILD,
        from_channel_id: CHANNEL_B,
        to_channel_id: null,
        occurred_utc: "2026-11-10T01:00:00.001",
      },
    ]);
  });

  test("o fuso da conexão não muda o instante gravado", async () => {
    const other = createDb(container.getConnectionUri(), { sessionTimeZone: "America/Sao_Paulo" });
    try {
      await insertRawVoiceEvents(other.db, [join({ occurredAt: new Date("2026-02-15T02:30:00Z") })]);
    } finally {
      await other.close();
    }
    const { rows } = await client.query(
      "select (occurred_at = '2026-02-15T02:30:00Z'::timestamptz) as same from raw_voice_events",
    );
    expect(rows).toEqual([{ same: true }]);
  });

  test("o horário da gravação vem do banco e é separado do horário do fato", async () => {
    await insertRawVoiceEvents(db, [join({ occurredAt: new Date("2020-01-01T00:00:00Z") })]);
    const { rows } = await client.query(
      `select (recorded_at > occurred_at) as later,
              (now() - recorded_at < interval '1 minute') as recent
         from raw_voice_events`,
    );
    expect(rows).toEqual([{ later: true, recent: true }]);
  });

  test("quem já estava na call quando o bot conecta e os marcos do bot também são gravados", async () => {
    const inserted = await insertRawVoiceEvents(db, [
      join({ eventType: "voice_present" }),
      botMarker("bot_start"),
      botMarker("bot_disconnect"),
      botMarker("bot_resume"),
      botMarker("bot_heartbeat"),
      botMarker("bot_stop"),
    ]);
    expect(inserted).toBe(6);
  });

  test("lista vazia devolve zero", async () => {
    expect(await insertRawVoiceEvents(db, [])).toBe(0);
  });
});

describe("idempotência", () => {
  test("gravar o mesmo evento duas vezes deixa uma linha só", async () => {
    const event = join();
    expect(await insertRawVoiceEvents(db, [event])).toBe(1);
    expect(await insertRawVoiceEvents(db, [event])).toBe(0);
    const { rows } = await client.query("select count(*)::int as n from raw_voice_events");
    expect(rows).toEqual([{ n: 1 }]);
  });

  test("a mesma chave repetida no mesmo lote grava uma vez", async () => {
    const event = join();
    expect(await insertRawVoiceEvents(db, [event, event])).toBe(1);
  });

  test("um reenvio com a mesma chave preserva o registro original", async () => {
    const event = join();
    await insertRawVoiceEvents(db, [event]);
    await insertRawVoiceEvents(db, [{ ...event, toChannelId: CHANNEL_B }]);
    const { rows } = await client.query("select to_channel_id from raw_voice_events");
    expect(rows).toEqual([{ to_channel_id: CHANNEL_A }]);
  });

  test("a chave é única também para quem escreve sem a função", async () => {
    const key = crypto.randomUUID();
    const sql = `insert into raw_voice_events
                   (idempotency_key, event_type, discord_user_id, guild_id, to_channel_id, occurred_at)
                 values ($1, 'voice_join', $2, $3, $4, now())`;
    await client.query(sql, [key, USER, GUILD, CHANNEL_A]);
    await expect(client.query(sql, [key, USER, GUILD, CHANNEL_A])).rejects.toMatchObject({
      code: "23505",
    });
  });
});

describe("lotes maiores que um bloco", () => {
  const total = INSERT_CHUNK_SIZE * 2 + 1;

  test("grava todos, em vários comandos, e conta só os novos", async () => {
    const events = Array.from({ length: total }, () => join());
    await insertRawVoiceEvents(db, events.slice(0, 10));
    expect(await insertRawVoiceEvents(db, events)).toBe(total - 10);
    const { rows } = await client.query("select count(*)::int as n from raw_voice_events");
    expect(rows).toEqual([{ n: total }]);
  });

  test("é tudo ou nada: linha inválida no último bloco não deixa gravados os anteriores", async () => {
    const events = Array.from({ length: total }, () => join());
    events[total - 1] = join({ guildId: "x" });
    await expect(insertRawVoiceEvents(db, events)).rejects.toThrow();
    const { rows } = await client.query("select count(*)::int as n from raw_voice_events");
    expect(rows).toEqual([{ n: 0 }]);
  });

  test("a mesma chave em blocos diferentes grava uma vez", async () => {
    const events = Array.from({ length: total }, () => join());
    events[total - 1] = { ...events[0]! };
    expect(await insertRawVoiceEvents(db, events)).toBe(total - 1);
  });
});

describe("regras do banco", () => {
  // Inserção direta em SQL: as regras valem para qualquer escritor, não só para o TypeScript.
  async function insertRaw(values: Record<string, unknown>): Promise<unknown> {
    const row: Record<string, unknown> = {
      idempotency_key: crypto.randomUUID(),
      event_type: "voice_join",
      discord_user_id: USER,
      guild_id: GUILD,
      from_channel_id: null,
      to_channel_id: CHANNEL_A,
      occurred_at: new Date(),
      ...values,
    };
    const keys = Object.keys(row);
    const params = keys.map((_, i) => `$${i + 1}`).join(", ");
    return client.query(
      `insert into raw_voice_events (${keys.join(", ")}) values (${params})`,
      Object.values(row),
    );
  }

  test("aceita a linha válida usada como base dos casos abaixo", async () => {
    await expect(insertRaw({})).resolves.toBeDefined();
  });

  test.each([
    ["tipo desconhecido", { event_type: "voice_mute" }],
    ["entrada sem canal de destino", { to_channel_id: null }],
    ["entrada com canal de origem", { from_channel_id: CHANNEL_B }],
    ["entrada sem usuário", { discord_user_id: null }],
    ["entrada sem servidor", { guild_id: null }],
    ["presença sem canal", { event_type: "voice_present", to_channel_id: null }],
    ["saída com canal de destino", { event_type: "voice_leave", from_channel_id: CHANNEL_B }],
    ["saída sem canal de origem", { event_type: "voice_leave", to_channel_id: null }],
    ["troca para o mesmo canal", { event_type: "voice_move", from_channel_id: CHANNEL_A }],
    ["troca sem origem", { event_type: "voice_move" }],
    ["marco do bot com usuário", { event_type: "bot_start", to_channel_id: null }],
    ["marco do bot com canal", { event_type: "bot_start", discord_user_id: null }],
    ["ID de usuário que não é snowflake", { discord_user_id: "usuario#1234" }],
    ["ID de servidor curto demais", { guild_id: "1234" }],
    ["ID de canal com letras", { to_channel_id: "abc456789012345678" }],
    ["chave de idempotência que não é UUID", { idempotency_key: "evento-1" }],
    ["sem horário do fato", { occurred_at: null }],
  ])("rejeita %s", async (_name, values) => {
    await expect(insertRaw(values)).rejects.toMatchObject({
      code: expect.stringMatching(/^2[23]/),
    });
  });
});
