import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { findErrorCode } from "./errors.ts";
import { RoleSetupError } from "./role-errors.ts";

/** Papel que o bot usa no Neon: só insere em raw_voice_events (exceção da D-26, até a F1-20). */
export const BOT_ROLE = "studyrooms_bot";
/** Papel do backup local (F1-24): só lê. */
export const BACKUP_ROLE = "studyrooms_backup";

const rolesSql = () => readFileSync(new URL("../sql/roles.sql", import.meta.url), "utf8");
const SNOWFLAKE = /^[0-9]{17,20}$/;
const PASSWORD = /^[A-Za-z0-9_-]{40,}$/;

/** 32 bytes aleatórios em base64url (43 caracteres): sem aspas nem caracteres especiais na URL. */
export function generatePassword(): string {
  return randomBytes(32).toString("base64url");
}

const SCRAM_ITERATIONS = 4096;

/**
 * Verificador SCRAM-SHA-256 no formato que o Postgres guarda (RFC 5802 e 7677), calculado aqui:
 * com `passwordFormat: "scram"`, o `ALTER ROLE ... PASSWORD` leva só o hash, e a senha nunca
 * aparece no comando nem no log do servidor (`log_statement`). O Neon não aceita esse formato
 * (veja `PasswordFormat`). A senha gerada só tem ASCII, então o SASLprep não a altera.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const b64 = (buffer: Buffer) => buffer.toString("base64");
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`;
}

/** Mesma conexão do dono (host, banco, parâmetros), com outro usuário e senha. */
export function roleUrl(adminUrl: string, role: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

/**
 * TLS visto do lado do cliente. No Neon, o proxy termina o TLS, e o `pg_stat_ssl` do servidor pode
 * dizer que não há SSL mesmo com a conexão da máquina até o Neon cifrada.
 */
function usesTls(client: pg.Client): boolean {
  const stream = (client as unknown as { connection?: { stream?: { encrypted?: boolean } } }).connection?.stream;
  return stream?.encrypted === true;
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export type RoleStatus = "created" | "rotated" | "kept";
export type RoleSetupResult = {
  bot: RoleStatus;
  backup: RoleStatus;
  /** Só as senhas novas (papel criado ou senha trocada). Nunca as imprima em log. */
  passwords: { bot?: string; backup?: string };
};

/** Senha de uma URL de conexão, como vem e decodificada, para ser filtrada de mensagens de erro. */
function urlPasswords(url: string): string[] {
  try {
    const raw = new URL(url).password;
    if (!raw) return [];
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // Codificação inválida: fica só a forma crua.
    }
    return [...new Set([raw, decoded])];
  } catch {
    return [];
  }
}

/** Um bloco de `sql/roles.sql`, aberto por uma linha `-- etapa: <nome>`. */
export type RolesSqlStep = { stage: string; sql: string };

/** Divide `sql/roles.sql` nas etapas marcadas, para cada uma rodar (e falhar) à parte. */
export function rolesSqlSteps(sql: string = rolesSql()): RolesSqlStep[] {
  const steps: RolesSqlStep[] = [];
  let current: { stage: string; lines: string[] } | undefined;
  for (const line of sql.split(/\r?\n/)) {
    const marker = /^--\s*etapa:\s*(.+?)\s*$/.exec(line);
    if (marker) {
      if (current) steps.push({ stage: current.stage, sql: current.lines.join("\n").trim() });
      current = { stage: marker[1]!, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim() !== "" && !line.trim().startsWith("--")) {
      throw new Error("roles.sql: comando antes da primeira linha `-- etapa:`");
    }
  }
  if (current) steps.push({ stage: current.stage, sql: current.lines.join("\n").trim() });
  return steps;
}

/**
 * Como a senha vai no `ALTER ROLE ... PASSWORD`:
 * - `plaintext`: a senha em texto, e o servidor calcula o SCRAM. É o que o Neon aceita: a extensão
 *   dele repassa a senha ao painel e recusa verificador pronto com erro XX000. O texto pode ir para
 *   o log do servidor, que no Neon não é exposto ao usuário.
 * - `scram`: o verificador SCRAM-SHA-256 calculado aqui; a senha não sai da máquina. Para Postgres
 *   comum.
 */
export type PasswordFormat = "plaintext" | "scram";

export type SetupRolesOptions = {
  /** Troca a senha dos papéis que já existem. Sem isso, papel existente mantém a senha. */
  rotate?: boolean;
  passwordFormat?: PasswordFormat;
  generate?: () => string;
  /**
   * Roda depois de tudo aplicado e antes do commit, com as senhas novas. Se lançar, nada é
   * confirmado: o CLI grava aqui o `.env.neon.local`, para nunca confirmar uma senha não guardada.
   */
  beforeCommit?: (result: RoleSetupResult) => void | Promise<void>;
};

/**
 * Cria os papéis do bot e do backup e aplica as permissões de `sql/roles.sql`. Papel que já existe
 * mantém a senha, a não ser com `rotate`. Precisa das migrations aplicadas antes. Tudo numa só
 * transação: se algo falhar, nada fica. A falha vem como `RoleSetupError`, com a etapa.
 */
export async function setupRoles(adminUrl: string, options: SetupRolesOptions = {}): Promise<RoleSetupResult> {
  const generate = options.generate ?? generatePassword;
  const format = options.passwordFormat ?? "scram";
  // Tudo o que é segredo e pode aparecer numa mensagem de erro, para ser filtrado dela.
  const secrets: string[] = urlPasswords(adminUrl);
  const step = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof RoleSetupError) throw error;
      throw new RoleSetupError(stage, error, secrets);
    }
  };

  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 15_000 });
  try {
    await step("conectar ao banco", () => client.connect());
    const existing = await step("ler os papéis existentes", () =>
      client.query<{ rolname: string }>("select rolname from pg_roles where rolname = any($1)", [[BOT_ROLE, BACKUP_ROLE]]),
    );
    const exists = new Set(existing.rows.map((row) => row.rolname));
    await step("abrir a transação", () => client.query("begin"));
    try {
      for (const { stage, sql } of rolesSqlSteps()) {
        await step(stage, () => client.query(sql));
      }
      const result: RoleSetupResult = { bot: "kept", backup: "kept", passwords: {} };
      for (const [key, role] of [["bot", BOT_ROLE], ["backup", BACKUP_ROLE]] as const) {
        if (exists.has(role) && !options.rotate) continue;
        const password = generate();
        if (!PASSWORD.test(password)) {
          throw new RoleSetupError(`definir a senha do ${key}`, new Error("senha gerada fora do formato esperado"));
        }
        secrets.push(password);
        const secret = format === "scram" ? scramVerifier(password) : password;
        secrets.push(secret);
        // ALTER ROLE não aceita parâmetro. A senha só tem [A-Za-z0-9_-], e o verificador, base64,
        // `$` e `:`: nenhum dos dois fecha a aspa.
        await step(`definir a senha do ${key}`, () => client.query(`alter role ${role} with login password '${secret}'`));
        result[key] = exists.has(role) ? "rotated" : "created";
        result.passwords[key] = password;
      }
      if (options.beforeCommit) await step("gravar as conexões novas", async () => options.beforeCommit!(result));
      await step("confirmar a transação (commit)", () => client.query("commit"));
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

export type AccessCheck = { name: string; ok: boolean; code?: string };

/** Roda `sql` e devolve o SQLSTATE do erro, ou null se deu certo. Nunca a mensagem. */
async function stateOf(client: pg.Client, sql: string, params: unknown[] = []): Promise<string | null> {
  await client.query("savepoint verificacao");
  try {
    await client.query(sql, params);
    await client.query("release savepoint verificacao");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint verificacao");
    return findErrorCode(error) ?? "desconhecido";
  }
}

const DENIED = new Set(["42501", "25006"]);

/**
 * Confere, com as credenciais do bot e do backup, o que cada um pode e não pode fazer. Tudo roda
 * numa transação desfeita no fim: nada fica gravado. O resultado traz só nomes e códigos.
 */
export async function checkAccess(
  urls: { bot: string; backup: string },
  options: { requireSsl: boolean },
): Promise<AccessCheck[]> {
  const checks: AccessCheck[] = [];
  const add = (name: string, state: string | null, expectDenied: boolean) => {
    const ok = expectDenied ? state !== null && DENIED.has(state) : state === null;
    checks.push(state === null ? { name, ok } : { name, ok, code: state });
  };

  for (const [label, url, role] of [["bot", urls.bot, BOT_ROLE], ["backup", urls.backup, BACKUP_ROLE]] as const) {
    let client: pg.Client;
    try {
      client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
      await client.connect();
    } catch (error) {
      checks.push({ name: `${label}: conecta`, ok: false, code: findErrorCode(error) ?? "desconhecido" });
      continue;
    }
    try {
      checks.push({ name: `${label}: conecta`, ok: true });
      const info = await client.query<{ user: string }>("select current_user as user");
      const { user } = info.rows[0]!;
      const ssl = usesTls(client);
      checks.push({ name: `${label}: usuário é o papel do ${label}`, ok: user === role });
      // Com a URL errada (por exemplo, a do dono), nada mais roda: as verificações tentam apagar.
      if (user !== role) continue;
      if (options.requireSsl) checks.push({ name: `${label}: conexão com SSL`, ok: ssl });
      await client.query("begin");
      if (label === "bot") {
        add(
          "bot: insere evento",
          await stateOf(
            client,
            "insert into raw_voice_events (idempotency_key, event_type, occurred_at) values ($1, 'bot_heartbeat', now())",
            [randomUUID()],
          ),
          false,
        );
        add("bot: não lê eventos", await stateOf(client, "select discord_user_id from raw_voice_events limit 1"), true);
        add("bot: não altera eventos", await stateOf(client, "update raw_voice_events set guild_id = guild_id"), true);
        add("bot: não apaga eventos", await stateOf(client, "delete from raw_voice_events"), true);
        add("bot: não apaga a tabela", await stateOf(client, "drop table raw_voice_events"), true);
        add("bot: não lê outras tabelas", await stateOf(client, "select 1 from drizzle.__drizzle_migrations limit 1"), true);
      } else {
        add("backup: lê eventos", await stateOf(client, "select 1 from raw_voice_events limit 1"), false);
        add("backup: lê migrations", await stateOf(client, "select 1 from drizzle.__drizzle_migrations limit 1"), false);
        add(
          "backup: não insere",
          await stateOf(
            client,
            "insert into raw_voice_events (idempotency_key, event_type, occurred_at) values ($1, 'bot_heartbeat', now())",
            [randomUUID()],
          ),
          true,
        );
        add("backup: não apaga eventos", await stateOf(client, "delete from raw_voice_events"), true);
      }
      await client.query("rollback");
    } finally {
      await client.end().catch(() => {});
    }
  }
  return checks;
}

function assertSnowflake(discordUserId: string): void {
  if (!SNOWFLAKE.test(discordUserId)) {
    throw new Error("ID do Discord inválido: use só os dígitos do ID (17 a 20).");
  }
}

/** Quantos eventos brutos existem de uma pessoa. Use a conexão do dono (NEON_ADMIN_URL). */
export async function countUserEvents(adminUrl: string, discordUserId: string): Promise<number> {
  assertSnowflake(discordUserId);
  return withClient(adminUrl, async (client) => {
    const result = await client.query<{ n: number }>(
      "select count(*)::int as n from raw_voice_events where discord_user_id = $1",
      [discordUserId],
    );
    return result.rows[0]!.n;
  });
}

/**
 * Exclusão a pedido (D-47): apaga todos os eventos brutos de uma pessoa que deixou de consentir.
 * É a única exceção à regra de preservar o dado bruto. Use a conexão do dono (NEON_ADMIN_URL).
 */
export async function forgetUser(adminUrl: string, discordUserId: string): Promise<{ deleted: number }> {
  assertSnowflake(discordUserId);
  return withClient(adminUrl, async (client) => {
    const result = await client.query("delete from raw_voice_events where discord_user_id = $1", [discordUserId]);
    return { deleted: result.rowCount ?? 0 };
  });
}

export type PingResult = { user: string; database: string; serverMajor: number; ssl: boolean };

/** Testa a conexão e devolve só o que identifica o destino, nunca a URL nem a senha. */
export async function pingDatabase(url: string): Promise<PingResult> {
  return withClient(url, async (client) => {
    const result = await client.query<{ user: string; database: string; version: string }>(
      `select current_user as user, current_database() as database,
              current_setting('server_version_num') as version`,
    );
    const row = result.rows[0]!;
    return {
      user: row.user,
      database: row.database,
      serverMajor: Math.floor(Number(row.version) / 10_000),
      ssl: usesTls(client),
    };
  });
}
