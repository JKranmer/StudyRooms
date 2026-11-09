import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.ts";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Aplica as migrations pendentes. As já aplicadas ficam registradas em
 * `drizzle.__drizzle_migrations` e não rodam de novo. Migrations só acrescentam: nunca apagam
 * nem reescrevem eventos já gravados.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, close } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
