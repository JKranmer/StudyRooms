// Testes de QA (Theo) da F1-48: o papel do bot no Neon tentando sair do "só insere", e a gravação
// do bot (SQL escrito à mão, contagem por rowCount) com esse papel, em lotes grandes e com repetição.
// Mesmo arranjo do neon-roles.test.ts: o dono do banco não é superusuário, só tem CREATEROLE.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  BACKUP_ROLE,
  BOT_ROLE,
  createDb,
  findErrorCode,
  INSERT_CHUNK_SIZE,
  insertRawVoiceEvents,
  roleUrl,
  runMigrations,
  setupRoles,
  type NewRawVoiceEvent,
} from "../src/index.ts";
import { startPostgres } from "./postgres-container.ts";

const USER = "123456789012345678";
const GUILD = "234567890123456789";
const CHANNEL = "345678901234567890";

let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let botUrl: string;
let backupUrl: string;

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function sqlState(url: string, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await withClient(url, (client) => client.query(sql, params));
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "sem-código";
  }
}

const owner = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  withClient(ownerUrl, (c) => c.query<T>(sql, params));

async function countRows(): Promise<number> {
  return (await owner<{ n: number }>("select count(*)::int as n from raw_voice_events")).rows[0]!.n;
}

function join(overrides: Partial<NewRawVoiceEvent> = {}): NewRawVoiceEvent {
  return {
    idempotencyKey: crypto.randomUUID(),
    eventType: "voice_join",
    discordUserId: USER,
    guildId: GUILD,
    toChannelId: CHANNEL,
    occurredAt: new Date("2026-11-09T12:00:00.123Z"),
    ...overrides,
  };
}

async function asBot<T>(fn: (db: ReturnType<typeof createDb>["db"]) => Promise<T>): Promise<T> {
  const { db, close } = createDb(botUrl, { pool: { max: 1 } });
  try {
    return await fn(db);
  } finally {
    await close();
  }
}

beforeAll(async () => {
  container = await startPostgres();
  const base = new URL(container.getConnectionUri());
  await withClient(container.getConnectionUri(), async (client) => {
    await client.query("create role neondb_owner login createrole password 'dono-falso'");
    await client.query("create database neondb owner neondb_owner");
  });
  base.username = "neondb_owner";
  base.password = "dono-falso";
  base.pathname = "/neondb";
  ownerUrl = base.toString();
  await runMigrations(ownerUrl);
  const { passwords } = await setupRoles(ownerUrl);
  botUrl = roleUrl(ownerUrl, BOT_ROLE, passwords.bot!);
  backupUrl = roleUrl(ownerUrl, BACKUP_ROLE, passwords.backup!);
});

afterAll(async () => {
  await container?.stop();
});

beforeEach(async () => {
  await owner("truncate raw_voice_events");
});

describe("gravação com o papel do bot", () => {
  test("lote grande, em vários blocos, com repetição dentro e entre blocos: conta só as linhas novas", async () => {
    const events = Array.from({ length: INSERT_CHUNK_SIZE * 2 + 500 }, () => join());
    // Repetições: dentro do primeiro bloco e entre o primeiro e o último.
    events[10] = { ...events[3]! };
    events[INSERT_CHUNK_SIZE * 2 + 100] = { ...events[5]! };
    const unique = new Set(events.map((e) => e.idempotencyKey)).size;
    expect(await asBot((db) => insertRawVoiceEvents(db, events))).toBe(unique);
    expect(await countRows()).toBe(unique);
    // Reenvio do lote inteiro (fila em disco depois de uma queda): nada novo, contagem zero.
    expect(await asBot((db) => insertRawVoiceEvents(db, events))).toBe(0);
    expect(await countRows()).toBe(unique);
  });

  test("lote misturando chaves já gravadas e novas conta só as novas", async () => {
    const old = Array.from({ length: 1200 }, () => join());
    await asBot((db) => insertRawVoiceEvents(db, old));
    const fresh = Array.from({ length: 900 }, () => join());
    const mixed = [...old.slice(0, 700), ...fresh, ...old.slice(700)];
    expect(await asBot((db) => insertRawVoiceEvents(db, mixed))).toBe(900);
    expect(await countRows()).toBe(2100);
  });

  test("linha inválida no último bloco desfaz tudo, também com o papel do bot", async () => {
    const events = Array.from({ length: INSERT_CHUNK_SIZE + 10 }, () => join());
    events[events.length - 1] = join({ eventType: "voice_leave", fromChannelId: null, toChannelId: CHANNEL });
    const error = await asBot((db) => insertRawVoiceEvents(db, events)).catch((e: unknown) => e);
    // O bot decide a quarentena pelo SQLSTATE (classes 22 e 23): ele tem de continuar achável.
    expect(findErrorCode(error)).toMatch(/^23/);
    expect(await countRows()).toBe(0);
  });

  test("dois bots ao mesmo tempo com as mesmas chaves: uma linha por chave, e a soma das contagens bate", async () => {
    const events = Array.from({ length: 1500 }, () => join());
    const [a, b] = await Promise.all([
      asBot((db) => insertRawVoiceEvents(db, events)),
      // Mesma ordem: em ordem inversa, dois lotes grandes podem dar deadlock (40P01), o que vale
      // para qualquer papel e que o gravador do bot trata como falha passageira.
      asBot((db) => insertRawVoiceEvents(db, events)),
    ]);
    expect(a + b).toBe(1500);
    expect(await countRows()).toBe(1500);
  });

  test("preserva os milissegundos e o instante em UTC, e nulos ficam nulos", async () => {
    const event = join({ eventType: "bot_heartbeat", discordUserId: null, guildId: null, toChannelId: null });
    await asBot((db) => insertRawVoiceEvents(db, [event]));
    const row = (
      await owner<{ at: string; user: string | null; recorded: boolean }>(
        "select to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS') as at, discord_user_id as user, recorded_at is not null as recorded from raw_voice_events",
      )
    ).rows;
    expect(row).toEqual([{ at: "2026-11-09T12:00:00.123", user: null, recorded: true }]);
  });

  test("o primeiro registro de uma chave fica como está quando outro evento chega com a mesma chave", async () => {
    const first = join();
    await asBot((db) => insertRawVoiceEvents(db, [first]));
    const forged = { ...first, discordUserId: "999999999999999999", occurredAt: new Date("2020-01-01T00:00:00Z") };
    expect(await asBot((db) => insertRawVoiceEvents(db, [forged]))).toBe(0);
    const rows = (await owner<{ user: string }>("select discord_user_id as user from raw_voice_events")).rows;
    expect(rows).toEqual([{ user: USER }]);
  });
});

describe("papel do bot tentando sair do só insere", () => {
  test("não usa ON CONFLICT DO UPDATE, RETURNING, nem lê pela chave", async () => {
    const key = crypto.randomUUID();
    const insert = "insert into raw_voice_events (idempotency_key, event_type, occurred_at) values ($1, 'bot_start', now())";
    expect(await sqlState(botUrl, `${insert} returning id`, [key])).toBe("42501");
    expect(await sqlState(botUrl, `${insert} returning idempotency_key`, [key])).toBe("42501");
    expect(
      await sqlState(botUrl, `${insert} on conflict (idempotency_key) do update set event_type = excluded.event_type`, [key]),
    ).toBe("42501");
    expect(await sqlState(botUrl, "select 1 from raw_voice_events where idempotency_key = $1", [key])).toBe("42501");
    expect(await sqlState(botUrl, "copy raw_voice_events to stdout")).toBe("42501");
  });

  test("não usa a sequência do id nem grava o id", async () => {
    expect(await sqlState(botUrl, "select nextval('raw_voice_events_id_seq')")).toBe("42501");
    expect(await sqlState(botUrl, "select setval('raw_voice_events_id_seq', 1)")).toBe("42501");
    expect(
      await sqlState(
        botUrl,
        "insert into raw_voice_events (id, idempotency_key, event_type, occurred_at) overriding system value values (1, $1, 'bot_start', now())",
        [crypto.randomUUID()],
      ),
    ).toBe("42501");
  });

  test("não altera a tabela nem os papéis, e não se dá permissão", async () => {
    expect(await sqlState(botUrl, "alter table raw_voice_events add column x int")).toBe("42501");
    expect(await sqlState(botUrl, "create index theo012_idx on raw_voice_events (occurred_at)")).toBe("42501");
    expect(await sqlState(botUrl, "grant select on raw_voice_events to studyrooms_bot")).toBe("42501");
    expect(await sqlState(botUrl, `alter role ${BOT_ROLE} connection limit -1`)).toBe("42501");
    expect(await sqlState(botUrl, `alter role ${BOT_ROLE} createrole`)).toBe("42501");
    expect(await sqlState(botUrl, `grant ${BACKUP_ROLE} to ${BOT_ROLE}`)).toBe("42501");
    expect(await sqlState(botUrl, "set role neondb_owner")).toBe("42501");
    expect(await sqlState(botUrl, `set role ${BACKUP_ROLE}`)).toBe("42501");
  });

  test("não cria schema nem função, e não lê a tabela por uma visão", async () => {
    expect(await sqlState(botUrl, "create schema theo012")).toBe("42501");
    expect(await sqlState(botUrl, "create function public.theo012() returns int language sql as 'select 1'")).toBe("42501");
    expect(await sqlState(botUrl, "create view public.theo012_v as select * from raw_voice_events")).toBe("42501");
  });

  test("não recebe permissão em tabela criada por migration futura", async () => {
    await owner("create table public.theo012_future (id int)");
    try {
      expect(await sqlState(botUrl, "insert into public.theo012_future values (1)")).toBe("42501");
      expect(await sqlState(botUrl, "select * from public.theo012_future")).toBe("42501");
      // O backup lê a tabela nova (default privileges), mas não grava nela.
      expect(await sqlState(backupUrl, "select * from public.theo012_future")).toBeNull();
      expect(["42501", "25006"]).toContain(await sqlState(backupUrl, "insert into public.theo012_future values (1)"));
    } finally {
      await owner("drop table public.theo012_future");
    }
  });

  test("rodar os papéis de novo tira permissão concedida por engano ao bot", async () => {
    await owner(`grant select, update, delete on raw_voice_events to ${BOT_ROLE}`);
    await owner(`grant select (discord_user_id) on raw_voice_events to ${BOT_ROLE}`);
    expect(await sqlState(botUrl, "select discord_user_id from raw_voice_events")).toBeNull();
    expect(await setupRoles(ownerUrl)).toEqual({ bot: "kept", backup: "kept", passwords: {} });
    expect(await sqlState(botUrl, "select discord_user_id from raw_voice_events")).toBe("42501");
    expect(await sqlState(botUrl, "delete from raw_voice_events")).toBe("42501");
    expect(await sqlState(botUrl, "update raw_voice_events set guild_id = null")).toBe("42501");
  });

  test("o backup não escapa do só leitura trocando a transação para escrita", async () => {
    expect(
      await withClient(backupUrl, async (client) => {
        await client.query("begin read write");
        try {
          await client.query(
            "insert into raw_voice_events (idempotency_key, event_type, occurred_at) values ($1, 'bot_start', now())",
            [crypto.randomUUID()],
          );
          return null;
        } catch (error) {
          return (error as { code?: string }).code;
        } finally {
          await client.query("rollback");
        }
      }),
    ).toBe("42501");
  });

  test("o limite de conexões do bot é 3: a quarta é recusada", async () => {
    const clients: pg.Client[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const c = new pg.Client({ connectionString: botUrl });
        await c.connect();
        clients.push(c);
      }
      expect(await sqlState(botUrl, "select 1")).toBe("53300");
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
