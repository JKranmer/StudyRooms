import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Database = NodePgDatabase<typeof schema>;

export interface DbOptions {
  /** Fuso da sessão. O padrão é UTC, regra do projeto; outro valor só existe para testes. */
  sessionTimeZone?: string;
}

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDb(connectionString: string, options: DbOptions = {}): DbHandle {
  const timeZone = options.sessionTimeZone ?? "UTC";
  if (!/^[A-Za-z0-9_+\-/]+$/.test(timeZone)) {
    throw new Error("Fuso de sessão inválido");
  }
  const pool = new pg.Pool({ connectionString, options: `-c TimeZone=${timeZone}` });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
