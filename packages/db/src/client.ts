import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { findErrorCode } from "./errors.ts";
import * as schema from "./schema.ts";

export type Database = NodePgDatabase<typeof schema>;

export interface PoolOptions {
  /** Conexões abertas ao mesmo tempo. */
  max?: number;
  /** Fecha a conexão ociosa depois desse tempo. Conexão aberta à toa impede o Neon de suspender. */
  idleTimeoutMillis?: number;
  /** Desiste de conectar depois desse tempo. Sem ele, um banco que não responde prende a chamada. */
  connectionTimeoutMillis?: number;
  /** Desiste de esperar a resposta de uma consulta depois desse tempo. */
  queryTimeoutMillis?: number;
}

export interface DbOptions {
  /** Fuso da sessão. O padrão é UTC, regra do projeto; outro valor só existe para testes. */
  sessionTimeZone?: string;
  pool?: PoolOptions;
  /**
   * Erro numa conexão ociosa do pool (o servidor caiu ou a encerrou). Recebe só o código, pois o
   * erro do pg traz a configuração da conexão, inclusive a senha. Sem este aviso, o erro é
   * ignorado: a próxima consulta abre outra conexão ou falha, e quem chamou trata.
   */
  onPoolError?: (code: string | undefined) => void;
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
  const { max, idleTimeoutMillis, connectionTimeoutMillis, queryTimeoutMillis } = options.pool ?? {};
  const pool = new pg.Pool({
    connectionString,
    options: `-c TimeZone=${timeZone}`,
    ...(max === undefined ? {} : { max }),
    ...(idleTimeoutMillis === undefined ? {} : { idleTimeoutMillis }),
    ...(connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis }),
    ...(queryTimeoutMillis === undefined ? {} : { query_timeout: queryTimeoutMillis }),
  });
  // Sem ouvinte, o `error` do pool vira exceção não tratada e derruba o processo.
  pool.on("error", (error) => options.onPoolError?.(findErrorCode(error)));
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
