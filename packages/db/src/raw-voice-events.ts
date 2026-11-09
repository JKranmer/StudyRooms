import type { Database } from "./client.ts";
import { rawVoiceEvents, type NewRawVoiceEvent } from "./schema.ts";

/**
 * Eventos por comando INSERT. Cada evento usa até 6 parâmetros, e o Postgres aceita no máximo
 * 65.535 por comando; 1.000 eventos (6.000 parâmetros) ficam longe do limite.
 */
export const INSERT_CHUNK_SIZE = 1000;

/**
 * Grava eventos brutos e devolve quantas linhas novas foram gravadas.
 *
 * - Idempotente: evento cuja chave já existe, no banco ou antes no mesmo lote, é ignorado e não
 *   conta; a linha original fica como está.
 * - Tudo ou nada: lotes maiores que INSERT_CHUNK_SIZE são gravados em vários comandos, mas numa
 *   só transação. Se um bloco falhar, nada do lote fica gravado e o erro é repassado; reenviar o
 *   lote inteiro é seguro.
 * - O erro do driver pode trazer os valores dos parâmetros (IDs do Discord) na mensagem: quem
 *   chama não deve registrar `error.message` em log.
 */
export async function insertRawVoiceEvents(
  db: Database,
  events: readonly NewRawVoiceEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  if (events.length <= INSERT_CHUNK_SIZE) return insertChunk(db, events);
  return db.transaction(async (tx) => {
    let inserted = 0;
    for (let start = 0; start < events.length; start += INSERT_CHUNK_SIZE) {
      inserted += await insertChunk(tx, events.slice(start, start + INSERT_CHUNK_SIZE));
    }
    return inserted;
  });
}

type Executor = Pick<Database, "insert">;

async function insertChunk(db: Executor, events: readonly NewRawVoiceEvent[]): Promise<number> {
  const inserted = await db
    .insert(rawVoiceEvents)
    .values([...events])
    .onConflictDoNothing({ target: rawVoiceEvents.idempotencyKey })
    .returning({ id: rawVoiceEvents.id });
  return inserted.length;
}
