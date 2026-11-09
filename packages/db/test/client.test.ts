import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { createDb } from "../src/index.ts";
import { startPostgres } from "./postgres-container.ts";

let container: StartedPostgreSqlContainer;
let admin: pg.Client;

beforeAll(async () => {
  container = await startPostgres();
  admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
});

afterAll(async () => {
  await admin?.end();
  await container?.stop();
});

async function backendsOf(applicationName: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    "select count(*)::int as n from pg_stat_activity where application_name = $1",
    [applicationName],
  );
  return rows[0]!.n;
}

test("conexão ociosa derrubada pelo servidor não derruba o processo e é avisada só pelo código", async () => {
  const codes: (string | undefined)[] = [];
  const name = "teste-ocioso-derrubado";
  const url = `${container.getConnectionUri()}?application_name=${name}`;
  const handle = createDb(url, { onPoolError: (code) => codes.push(code) });
  try {
    await handle.db.execute(sql`select 1`);
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1", [name]);
    await expect.poll(() => codes.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(codes[0]).toBe("57P01");
    // O pool segue utilizável: a próxima consulta abre outra conexão.
    await expect(handle.db.execute(sql`select 1`)).resolves.toBeDefined();
  } finally {
    await handle.close();
  }
});

test("sem onPoolError, o erro da conexão ociosa também não derruba o processo", async () => {
  const name = "teste-ocioso-sem-handler";
  const handle = createDb(`${container.getConnectionUri()}?application_name=${name}`);
  try {
    await handle.db.execute(sql`select 1`);
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1", [name]);
    await expect.poll(() => backendsOf(name), { timeout: 5_000 }).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(handle.db.execute(sql`select 1`)).resolves.toBeDefined();
  } finally {
    await handle.close();
  }
});

test("idleTimeoutMillis fecha a conexão ociosa (o Neon pode suspender)", async () => {
  const name = "teste-ociosa-fecha";
  const handle = createDb(`${container.getConnectionUri()}?application_name=${name}`, {
    pool: { idleTimeoutMillis: 200 },
  });
  try {
    await handle.db.execute(sql`select 1`);
    expect(await backendsOf(name)).toBe(1);
    await expect.poll(() => backendsOf(name), { timeout: 5_000 }).toBe(0);
  } finally {
    await handle.close();
  }
});

test("connectionTimeoutMillis limita a espera por um banco que não responde", async () => {
  // Porta que aceita TCP e nunca responde: um servidor que não fala o protocolo.
  const net = await import("node:net");
  const sockets = new Set<import("node:net").Socket>();
  const silent = net.createServer((socket) => sockets.add(socket));
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const port = (silent.address() as { port: number }).port;
  const handle = createDb(`postgres://u:p@127.0.0.1:${port}/db`, { pool: { connectionTimeoutMillis: 300 } });
  const started = Date.now();
  try {
    await expect(handle.db.execute(sql`select 1`)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  } finally {
    await handle.close();
    for (const socket of sockets) socket.destroy();
    silent.close();
  }
});
