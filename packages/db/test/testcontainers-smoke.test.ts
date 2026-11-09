import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPostgres } from "./postgres-container.ts";

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await container?.stop();
});

test("Testcontainers conecta a um Postgres no Docker atual", async () => {
  const client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    const { rows } = await client.query<{ tz: string }>("select current_setting('TimeZone') as tz");
    expect(rows[0]?.tz).toBe("UTC");
  } finally {
    await client.end();
  }
});
