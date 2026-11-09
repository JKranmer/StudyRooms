import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../src/index.ts";
import { startPostgres } from "./postgres-container.ts";
import { schemaSnapshot } from "./schema-snapshot.ts";

let container: StartedPostgreSqlContainer;
let client: pg.Client;

beforeAll(async () => {
  container = await startPostgres();
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

test("migrate em banco vazio cria as tabelas e registra as migrations", async () => {
  const before = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  expect(before.rows[0]?.n).toBe(0);

  await runMigrations(container.getConnectionUri());

  const tables = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  expect(tables.rows.map((r) => r.table_name)).toEqual(["raw_voice_events"]);
  const applied = await client.query<{ n: number }>(
    "select count(*)::int as n from drizzle.__drizzle_migrations",
  );
  expect(applied.rows[0]?.n).toBeGreaterThan(0);
});

test("a segunda execução do migrate não altera nada", async () => {
  const before = await schemaSnapshot(client);
  await runMigrations(container.getConnectionUri());
  expect(await schemaSnapshot(client)).toEqual(before);
});
