import { sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import type { NewRawVoiceEvent } from "./schema.ts";

/**
 * Eventos por comando INSERT. Cada evento usa 7 parâmetros, e o Postgres aceita no máximo
 * 65.535 por comando; 1.000 eventos (7.000 parâmetros) ficam longe do limite.
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

type Executor = Pick<Database, "execute">;

/**
 * SQL escrito à mão, e não o `insert` do Drizzle, por causa do papel do bot no Neon (F1-48), que só
 * pode inserir nestas 7 colunas: o Drizzle lista também `id` e `recorded_at` (com DEFAULT) e pede
 * `RETURNING`, que exige permissão de leitura. Pelo mesmo motivo, o `ON CONFLICT` não nomeia a
 * coluna (nomear exige leitura dela): a única restrição única que um evento pode violar é a da
 * chave de idempotência, porque o `id` é gerado pelo banco. A contagem vem do `rowCount`: com
 * `ON CONFLICT DO NOTHING`, só as linhas novas contam.
 */
async function insertChunk(db: Executor, events: readonly NewRawVoiceEvent[]): Promise<number> {
  const rows = events.map(
    (e) =>
      sql`(${e.idempotencyKey}, ${e.eventType}, ${e.discordUserId ?? null}, ${e.guildId ?? null}, ${e.fromChannelId ?? null}, ${e.toChannelId ?? null}, ${e.occurredAt.toISOString()})`,
  );
  const result = await db.execute(sql`
    insert into raw_voice_events
      (idempotency_key, event_type, discord_user_id, guild_id, from_channel_id, to_channel_id, occurred_at)
    values ${sql.join(rows, sql`, `)}
    on conflict do nothing`);
  return result.rowCount ?? 0;
}
