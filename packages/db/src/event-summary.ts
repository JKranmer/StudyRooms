import pg from "pg";
import { rawVoiceEventTypes } from "./schema.ts";

// Resumo dos eventos brutos por tipo (F0-06/F1-49): confere o roteiro de voz na VM sem imprimir
// IDs do Discord. Só contagens, horários em UTC e o número de pessoas distintas. Basta leitura:
// o comando usa a conexão só leitura do backup (NEON_BACKUP_URL).

export const DEFAULT_SUMMARY_HOURS = 24;
export const MAX_SUMMARY_HOURS = 720;

export type EventTypeSummary = { eventType: string; count: number; lastOccurredAt: Date | null };
export type EventSummary = {
  byType: EventTypeSummary[];
  distinctUsers: number;
  lastRecordedAt: Date | null;
};

/** `[--hours N]`. Nunca repete o argumento recusado: pode ser um ID colado por engano. */
export function parseSummaryArgs(args: readonly string[]): { hours: number } | { error: string } {
  let hours = DEFAULT_SUMMARY_HOURS;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--hours") return { error: "argumento desconhecido. Uso: neon summary [--hours N]." };
    const value = args[++i];
    if (value === undefined || !/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > MAX_SUMMARY_HOURS) {
      return { error: `use --hours com um número inteiro de 1 a ${MAX_SUMMARY_HOURS} (padrão: ${DEFAULT_SUMMARY_HOURS}).` };
    }
    hours = Number(value);
  }
  return { hours };
}

function utc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Linhas do resumo: todos os tipos conhecidos, na ordem do schema, e depois os desconhecidos. */
export function formatEventSummary(summary: EventSummary, hours: number): string[] {
  const period = hours === 1 ? "na última 1 h" : `nas últimas ${hours} h`;
  const total = summary.byType.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return [`Nenhum evento no Neon ${period}.`];
  const known = new Set<string>(rawVoiceEventTypes);
  const byType = new Map(summary.byType.map((row) => [row.eventType, row]));
  const rows: EventTypeSummary[] = [
    ...rawVoiceEventTypes.map((type) => byType.get(type) ?? { eventType: type, count: 0, lastOccurredAt: null }),
    ...summary.byType.filter((row) => !known.has(row.eventType)),
  ];
  const lines = [`Eventos no Neon ${period} (horários em UTC):`];
  for (const row of rows) {
    const base = `  ${row.eventType.padEnd(16)} ${String(row.count).padStart(3)}`;
    lines.push(row.count > 0 && row.lastOccurredAt ? `${base}  último em ${utc(row.lastOccurredAt)}` : base);
  }
  const recorded = summary.lastRecordedAt ? utc(summary.lastRecordedAt) : "desconhecida";
  lines.push(`Total: ${total}. Pessoas distintas: ${summary.distinctUsers}. Última gravação no banco: ${recorded}.`);
  return lines;
}

/** Conta os eventos com `occurred_at` nas últimas `hours` horas antes de `now`. Não lê IDs. */
export async function summarizeEvents(
  url: string,
  options: { hours: number; now?: Date },
): Promise<EventSummary> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - options.hours * 3_600_000);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const params = [since.toISOString(), now.toISOString()];
    const window = "occurred_at > $1::timestamptz and occurred_at <= $2::timestamptz";
    const types = await client.query<{ event_type: string; n: number; last: Date }>(
      `select event_type, count(*)::int as n, max(occurred_at) as last
         from raw_voice_events where ${window} group by event_type order by event_type`,
      params,
    );
    const totals = await client.query<{ users: number; recorded: Date | null }>(
      `select count(distinct discord_user_id)::int as users, max(recorded_at) as recorded
         from raw_voice_events where ${window}`,
      params,
    );
    return {
      byType: types.rows.map((row) => ({ eventType: row.event_type, count: row.n, lastOccurredAt: row.last })),
      distinctUsers: totals.rows[0]?.users ?? 0,
      lastRecordedAt: totals.rows[0]?.recorded ?? null,
    };
  } finally {
    await client.end();
  }
}
