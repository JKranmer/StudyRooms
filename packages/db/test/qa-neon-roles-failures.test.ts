// F1-48 (QA): falha em cada etapa do `setupRoles` num Postgres real que imita o Neon (dono só com
// CREATEROLE). Nenhuma falha pode deixar papel com LOGIN sem senha, nem senha nova confirmada sem
// ter passado pelo beforeCommit, e rodar de novo depois da falha tem de funcionar.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { BACKUP_ROLE, BOT_ROLE, RoleSetupError, roleUrl, rolesSqlSteps, runMigrations, setupRoles } from "../src/index.ts";
import { startPostgres } from "./postgres-container.ts";

let container: StartedPostgreSqlContainer;
let ownerUrl: string;

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

async function canLogin(role: string, password: string): Promise<string | null> {
  try {
    await withClient(roleUrl(ownerUrl, role, password), (c) => c.query("select 1"));
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "sem-código";
  }
}

type RoleRow = { rolname: string; rolcanlogin: boolean; has_password: boolean; rolconnlimit: number; rolpassword: string | null };
async function roles(): Promise<RoleRow[]> {
  const r = await withClient(container.getConnectionUri(), (c) =>
    c.query<RoleRow>(
      `select rolname, rolcanlogin, rolpassword is not null as has_password, rolconnlimit, rolpassword
         from pg_authid where rolname = any($1) order by 1`,
      [[BOT_ROLE, BACKUP_ROLE]],
    ),
  );
  return r.rows;
}

/** Faz falhar o comando para o qual `match` devolver true. */
function failWhen(match: (sql: string) => boolean, code = "XX000") {
  const real = pg.Client.prototype.query;
  const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
    const sql = typeof args[0] === "string" ? args[0] : "";
    if (match(sql)) return Promise.reject(Object.assign(new Error(`falha simulada em ${sql}`), { code }));
    return (real as (...a: unknown[]) => unknown).apply(this, args);
  } as never);
  return () => spy.mockRestore();
}

async function attempt(options: Parameters<typeof setupRoles>[1], match?: (sql: string) => boolean) {
  const restore = match ? failWhen(match) : () => {};
  try {
    return { result: await setupRoles(ownerUrl, options), error: undefined };
  } catch (error) {
    return { result: undefined, error };
  } finally {
    restore();
  }
}

/** Falha alvo, com a etapa esperada. */
const sqlTargets = rolesSqlSteps().map((s) => ({ stage: s.stage, match: (sql: string) => sql === s.sql }));
const passwordTargets = [
  { stage: "definir a senha do bot", match: (sql: string) => sql.startsWith(`alter role ${BOT_ROLE} with login password`) },
  { stage: "definir a senha do backup", match: (sql: string) => sql.startsWith(`alter role ${BACKUP_ROLE} with login password`) },
  { stage: "confirmar a transação (commit)", match: (sql: string) => sql === "commit" },
];
const allTargets = [...sqlTargets, ...passwordTargets];

beforeAll(async () => {
  container = await startPostgres();
  await withClient(container.getConnectionUri(), async (client) => {
    await client.query("create role neondb_owner login createrole password 'dono-falso'");
    await client.query("create database neondb owner neondb_owner");
  });
  ownerUrl = urlFor("neondb_owner", "dono-falso");
  await runMigrations(ownerUrl);
});

afterAll(async () => {
  await container?.stop();
});

describe("primeira execução falhando em cada etapa", () => {
  test.each(allTargets)("$stage: erro com a etapa e nenhum papel sobra", async ({ stage, match }) => {
    const { error } = await attempt({ passwordFormat: "plaintext" }, match);
    expect(error).toBeInstanceOf(RoleSetupError);
    expect((error as RoleSetupError).stage).toBe(stage);
    expect(await roles()).toEqual([]);
  });

  test("beforeCommit falhando: nenhum papel sobra", async () => {
    const { error } = await attempt({
      passwordFormat: "plaintext",
      beforeCommit: () => {
        throw new Error("disco cheio");
      },
    });
    expect((error as RoleSetupError).stage).toBe("gravar as conexões novas");
    expect(await roles()).toEqual([]);
  });

  test("durante o beforeCommit, nada está visível para outra conexão e a senha pendente não entra", async () => {
    let seenFromOutside: RoleRow[] | undefined;
    let loginDuring: string | null | undefined;
    const { error } = await attempt({
      passwordFormat: "plaintext",
      beforeCommit: async (pending) => {
        seenFromOutside = await roles();
        loginDuring = await canLogin(BOT_ROLE, pending.passwords.bot!);
        throw new Error("cancela");
      },
    });
    expect(error).toBeInstanceOf(RoleSetupError);
    expect(seenFromOutside).toEqual([]);
    expect(loginDuring).toBe("28P01");
  });

  test("depois de todas as falhas, rodar de novo cria os dois papéis com LOGIN e senha", async () => {
    const result = await setupRoles(ownerUrl, { passwordFormat: "plaintext" });
    expect(result.bot).toBe("created");
    expect(result.backup).toBe("created");
    const rows = await roles();
    expect(rows.map((r) => [r.rolname, r.rolcanlogin, r.has_password, r.rolconnlimit])).toEqual([
      [BACKUP_ROLE, true, true, 2],
      [BOT_ROLE, true, true, 3],
    ]);
    expect(await canLogin(BOT_ROLE, result.passwords.bot!)).toBeNull();
    expect(await canLogin(BACKUP_ROLE, result.passwords.backup!)).toBeNull();
    current = result.passwords as { bot: string; backup: string };
  });
});

let current: { bot: string; backup: string };

describe("--rotate falhando em cada etapa (papéis já existem)", () => {
  test.each(allTargets)("$stage: senhas antigas continuam valendo e nada muda", async ({ stage, match }) => {
    const before = await roles();
    const { error } = await attempt({ passwordFormat: "plaintext", rotate: true }, match);
    expect((error as RoleSetupError).stage).toBe(stage);
    expect(await roles()).toEqual(before);
    expect(await canLogin(BOT_ROLE, current.bot)).toBeNull();
    expect(await canLogin(BACKUP_ROLE, current.backup)).toBeNull();
  });

  test("durante o beforeCommit do rotate, a senha antiga ainda entra e a nova não", async () => {
    let oldDuring: string | null | undefined;
    let newDuring: string | null | undefined;
    let committed: { bot?: string; backup?: string } = {};
    const { result, error } = await attempt({
      passwordFormat: "plaintext",
      rotate: true,
      beforeCommit: async (pending) => {
        committed = { ...pending.passwords };
        oldDuring = await canLogin(BOT_ROLE, current.bot);
        newDuring = await canLogin(BOT_ROLE, pending.passwords.bot!);
      },
    });
    expect(error).toBeUndefined();
    expect(oldDuring).toBeNull();
    expect(newDuring).toBe("28P01");
    // Depois do commit, vale exatamente o que o beforeCommit recebeu.
    expect(result!.passwords).toEqual(committed);
    expect(await canLogin(BOT_ROLE, current.bot)).toBe("28P01");
    expect(await canLogin(BOT_ROLE, committed.bot!)).toBeNull();
    expect(await canLogin(BACKUP_ROLE, committed.backup!)).toBeNull();
    current = committed as { bot: string; backup: string };
  });

  test("dois `roles --rotate` ao mesmo tempo: as senhas que valem são as de quem confirmou", async () => {
    const outcomes = await Promise.allSettled([
      setupRoles(ownerUrl, { passwordFormat: "plaintext", rotate: true }),
      setupRoles(ownerUrl, { passwordFormat: "plaintext", rotate: true }),
    ]);
    const ok = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof setupRoles>>> => o.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    // A última a confirmar define as senhas; ao menos um dos resultados tem de entrar nos dois papéis.
    const working = [];
    for (const o of ok) {
      const bot = await canLogin(BOT_ROLE, o.value.passwords.bot!);
      const backup = await canLogin(BACKUP_ROLE, o.value.passwords.backup!);
      // Nunca um resultado com metade das senhas valendo (bot de uma, backup de outra).
      expect(bot === null).toBe(backup === null);
      if (bot === null) working.push(o.value);
    }
    expect(working.length).toBe(1);
    current = working[0]!.passwords as { bot: string; backup: string };
  });
});

describe("rodar de novo sem rotate depois de falha", () => {
  test("mantém as senhas e reaplica atributos alterados por fora", async () => {
    await withClient(ownerUrl, (c) => c.query(`alter role ${BOT_ROLE} connection limit 50`));
    const { error } = await attempt({ passwordFormat: "plaintext" }, sqlTargets[3]!.match);
    expect(error).toBeInstanceOf(RoleSetupError);
    expect((await roles()).find((r) => r.rolname === BOT_ROLE)!.rolconnlimit).toBe(50);
    const result = await setupRoles(ownerUrl, { passwordFormat: "plaintext" });
    expect(result).toEqual({ bot: "kept", backup: "kept", passwords: {} });
    expect((await roles()).find((r) => r.rolname === BOT_ROLE)!.rolconnlimit).toBe(3);
    expect(await canLogin(BOT_ROLE, current.bot)).toBeNull();
  });
});
