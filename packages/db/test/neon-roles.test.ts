// F1-48: papéis do Neon, testados num Postgres real que imita o Neon: o dono do banco não é
// superusuário, só tem CREATEROLE (como o neondb_owner).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  BACKUP_ROLE,
  BOT_ROLE,
  checkAccess,
  countUserEvents,
  createDb,
  forgetUser,
  insertRawVoiceEvents,
  pingDatabase,
  roleUrl,
  runMigrations,
  scramVerifier,
  setupRoles,
  type NewRawVoiceEvent,
} from "../src/index.ts";
import { startPostgres } from "./postgres-container.ts";

const USER_A = "123456789012345678";
const USER_B = "223456789012345678";
const GUILD = "234567890123456789";
const CHANNEL = "345678901234567890";

let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let botUrl: string;
let backupUrl: string;

function urlFor(user: string, password: string): string {
  const url = new URL(container.getConnectionUri());
  url.username = user;
  url.password = password;
  url.pathname = "/neondb";
  return url.toString();
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** SQLSTATE do erro (inclusive ao conectar), ou null se deu certo. */
async function sqlState(url: string, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await withClient(url, (client) => client.query(sql, params));
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "sem-código";
  }
}

function join(user: string): NewRawVoiceEvent {
  return {
    idempotencyKey: crypto.randomUUID(),
    eventType: "voice_join",
    discordUserId: user,
    guildId: GUILD,
    toChannelId: CHANNEL,
    occurredAt: new Date("2026-11-09T12:00:00Z"),
  };
}

let passwords: { bot?: string; backup?: string };

beforeAll(async () => {
  container = await startPostgres();
  await withClient(container.getConnectionUri(), async (client) => {
    await client.query("create role neondb_owner login createrole password 'dono-falso'");
    await client.query("create database neondb owner neondb_owner");
  });
  ownerUrl = urlFor("neondb_owner", "dono-falso");
  await runMigrations(ownerUrl);
  const result = await setupRoles(ownerUrl);
  passwords = result.passwords;
  botUrl = roleUrl(ownerUrl, BOT_ROLE, passwords.bot!);
  backupUrl = roleUrl(ownerUrl, BACKUP_ROLE, passwords.backup!);
});

afterAll(async () => {
  await container?.stop();
});

describe("setupRoles", () => {
  test("cria os dois papéis com senhas fortes e diferentes, sem superpoderes", async () => {
    expect(passwords.bot).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(passwords.backup).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(passwords.bot).not.toBe(passwords.backup);
    const roles = await withClient(ownerUrl, (client) =>
      client.query<{ rolname: string; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolconnlimit: number }>(
        "select rolname, rolsuper, rolcreaterole, rolcreatedb, rolconnlimit from pg_roles where rolname = any($1) order by 1",
        [[BOT_ROLE, BACKUP_ROLE]],
      ),
    );
    expect(roles.rows).toEqual([
      { rolname: BACKUP_ROLE, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolconnlimit: 2 },
      { rolname: BOT_ROLE, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolconnlimit: 3 },
    ]);
  });

  test("rodar de novo sem rotate mantém as senhas; com rotate, troca", async () => {
    const again = await setupRoles(ownerUrl);
    expect(again).toEqual({ bot: "kept", backup: "kept", passwords: {} });
    expect(await sqlState(botUrl, "select 1")).toBeNull();

    const rotated = await setupRoles(ownerUrl, { rotate: true });
    expect(rotated.bot).toBe("rotated");
    expect(await sqlState(botUrl, "select 1")).toBe("28P01");
    passwords = rotated.passwords;
    botUrl = roleUrl(ownerUrl, BOT_ROLE, passwords.bot!);
    backupUrl = roleUrl(ownerUrl, BACKUP_ROLE, passwords.backup!);
    expect(await sqlState(botUrl, "select 1")).toBeNull();
  });

  test("roleUrl troca só usuário e senha, mantendo host, banco e parâmetros", () => {
    const url = roleUrl("postgres://dono:x@ep-abc.us-east-1.aws.neon.tech/neondb?sslmode=require", BOT_ROLE, "s3nh4");
    expect(url).toBe(`postgres://${BOT_ROLE}:s3nh4@ep-abc.us-east-1.aws.neon.tech/neondb?sslmode=require`);
  });
});

describe("papel do bot", () => {
  test("grava eventos pela mesma função do bot, sem duplicar", async () => {
    const { db, close } = createDb(botUrl);
    try {
      const event = join(USER_A);
      expect(await insertRawVoiceEvents(db, [event])).toBe(1);
      expect(await insertRawVoiceEvents(db, [event])).toBe(0);
    } finally {
      await close();
    }
  });

  test("não lê, não altera, não apaga e não cria nada", async () => {
    expect(await sqlState(botUrl, "select discord_user_id from raw_voice_events")).toBe("42501");
    expect(await sqlState(botUrl, "select count(*) from raw_voice_events")).toBe("42501");
    expect(await sqlState(botUrl, "update raw_voice_events set guild_id = guild_id")).toBe("42501");
    expect(await sqlState(botUrl, "delete from raw_voice_events")).toBe("42501");
    expect(await sqlState(botUrl, "truncate raw_voice_events")).toBe("42501");
    expect(await sqlState(botUrl, "drop table raw_voice_events")).toBe("42501");
    expect(await sqlState(botUrl, "select * from drizzle.__drizzle_migrations")).toBe("42501");
    expect(await sqlState(botUrl, "create table public.x (id int)")).toBe("42501");
  });

  test("não forja o horário de gravação nem o id", async () => {
    expect(
      await sqlState(
        botUrl,
        "insert into raw_voice_events (idempotency_key, event_type, occurred_at, recorded_at) values ($1, 'bot_start', now(), now() - interval '1 day')",
        [crypto.randomUUID()],
      ),
    ).toBe("42501");
  });
});

describe("papel do backup", () => {
  test("lê as tabelas de eventos e de migrations", async () => {
    expect(await sqlState(backupUrl, "select * from raw_voice_events")).toBeNull();
    expect(await sqlState(backupUrl, "select * from drizzle.__drizzle_migrations")).toBeNull();
    expect(await sqlState(backupUrl, "select last_value from raw_voice_events_id_seq")).toBeNull();
  });

  test("não grava, não altera e não apaga", async () => {
    const insert = await sqlState(
      backupUrl,
      "insert into raw_voice_events (idempotency_key, event_type, occurred_at) values ($1, 'bot_start', now())",
      [crypto.randomUUID()],
    );
    expect(["42501", "25006"]).toContain(insert);
    expect(["42501", "25006"]).toContain(await sqlState(backupUrl, "delete from raw_voice_events"));
    expect(["42501", "25006"]).toContain(await sqlState(backupUrl, "drop table raw_voice_events"));
  });
});

describe("checkAccess", () => {
  test("com as credenciais certas, todas as verificações passam (sem exigir SSL no teste)", async () => {
    const checks = await checkAccess({ bot: botUrl, backup: backupUrl }, { requireSsl: false });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(8);
  });

  test("exigindo SSL num banco sem SSL, a verificação de SSL falha", async () => {
    const checks = await checkAccess({ bot: botUrl, backup: backupUrl }, { requireSsl: true });
    expect(checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["bot: conexão com SSL", "backup: conexão com SSL"]);
  });

  test("com a URL do dono no lugar da do bot, acusa e não roda as verificações que apagam", async () => {
    const checks = await checkAccess({ bot: ownerUrl, backup: backupUrl }, { requireSsl: false });
    const bot = checks.filter((c) => c.name.startsWith("bot:"));
    expect(bot).toEqual([
      { name: "bot: conecta", ok: true },
      { name: "bot: usuário é o papel do bot", ok: false },
    ]);
  });

  test("não deixa linha de teste no banco", async () => {
    const before = await withClient(ownerUrl, (c) => c.query<{ n: number }>("select count(*)::int as n from raw_voice_events"));
    await checkAccess({ bot: botUrl, backup: backupUrl }, { requireSsl: false });
    const after = await withClient(ownerUrl, (c) => c.query<{ n: number }>("select count(*)::int as n from raw_voice_events"));
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});

describe("forgetUser (exclusão a pedido)", () => {
  test("apaga só os eventos da pessoa e devolve as contagens", async () => {
    const { db, close } = createDb(botUrl);
    try {
      await insertRawVoiceEvents(db, [join(USER_B), join(USER_B), join(USER_A)]);
    } finally {
      await close();
    }
    const a = await countUserEvents(ownerUrl, USER_A);
    expect(await countUserEvents(ownerUrl, USER_B)).toBe(2);
    expect(await forgetUser(ownerUrl, USER_B)).toEqual({ deleted: 2 });
    expect(await countUserEvents(ownerUrl, USER_B)).toBe(0);
    expect(await countUserEvents(ownerUrl, USER_A)).toBe(a);
  });

  test("recusa ID que não é snowflake", async () => {
    await expect(forgetUser(ownerUrl, "1 or 1=1")).rejects.toThrow(/ID do Discord/);
    await expect(countUserEvents(ownerUrl, "")).rejects.toThrow(/ID do Discord/);
  });
});

describe("pingDatabase", () => {
  test("devolve usuário, versão maior e SSL, sem a URL", async () => {
    const info = await pingDatabase(ownerUrl);
    expect(info).toEqual({ user: "neondb_owner", database: "neondb", serverMajor: 17, ssl: false });
  });
});

describe("senha enviada como hash SCRAM", () => {
  test("scramVerifier: formato do Postgres, salt aleatório, sem a senha no texto", () => {
    const a = scramVerifier("senha-de-teste-bem-longa-0123456789abcdefgh");
    const b = scramVerifier("senha-de-teste-bem-longa-0123456789abcdefgh");
    expect(a).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("senha-de-teste");
  });

  test("rotate não manda a senha em texto em nenhum comando, e o login com ela funciona", async () => {
    const sent: string[] = [];
    const realQuery = pg.Client.prototype.query;
    const capture = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const first = args[0];
      sent.push(typeof first === "string" ? first : JSON.stringify(first));
      return (realQuery as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    let rotated;
    try {
      rotated = await setupRoles(ownerUrl, { rotate: true });
    } finally {
      capture.mockRestore();
    }
    passwords = rotated.passwords;
    botUrl = roleUrl(ownerUrl, BOT_ROLE, passwords.bot!);
    backupUrl = roleUrl(ownerUrl, BACKUP_ROLE, passwords.backup!);
    const all = sent.join(" | ");
    expect(all).toContain("SCRAM-SHA-256$4096:");
    expect(all).not.toContain(passwords.bot!);
    expect(all).not.toContain(passwords.backup!);
    expect(await sqlState(botUrl, "select 1")).toBeNull();
    expect(await sqlState(backupUrl, "select 1")).toBeNull();
    const stored = await withClient(container.getConnectionUri(), (c) =>
      c.query<{ rolpassword: string }>("select rolpassword from pg_authid where rolname = $1", [BOT_ROLE]),
    );
    expect(stored.rows[0]!.rolpassword).toMatch(/^SCRAM-SHA-256\$4096:/);
  });
});
