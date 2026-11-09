import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Eventos de voz que envolvem uma pessoa.
export const userVoiceEventTypes = ["voice_join", "voice_leave", "voice_move", "voice_present"] as const;
// Marcos do próprio bot: sem eles, uma sessão aberta durante uma queda não pode ser fechada depois.
export const botEventTypes = [
  "bot_start",
  "bot_disconnect",
  "bot_resume",
  "bot_heartbeat",
  "bot_stop",
] as const;
export const rawVoiceEventTypes = [...userVoiceEventTypes, ...botEventTypes] as const;
export type RawVoiceEventType = (typeof rawVoiceEventTypes)[number];

const SNOWFLAKE = "^[0-9]{17,20}$";

/**
 * Fato bruto observado pelo bot (coleta antecipada, D-26). Só acrescenta linhas: as regras de
 * sessão são aplicadas no cálculo (ADR 0005), nunca reescrevendo estes dados. Não há coluna de
 * mudo, transmissão nem mensagem, por privacidade.
 */
export const rawVoiceEvents = pgTable(
  "raw_voice_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // Gerada pelo bot no momento em que observa o evento e guardada com ele na fila em disco:
    // reenviar o mesmo evento não cria uma segunda linha.
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    eventType: text("event_type").$type<RawVoiceEventType>().notNull(),
    // Snowflakes do Discord como texto: passam de 2^53 e não cabem com segurança em number.
    discordUserId: text("discord_user_id"),
    guildId: text("guild_id"),
    fromChannelId: text("from_channel_id"),
    toChannelId: text("to_channel_id"),
    // Horário do fato, em UTC. Vem do bot, não do banco: um evento da fila pode chegar atrasado.
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    // Horário da gravação, preenchido pelo banco.
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("raw_voice_events_user_occurred_idx").on(t.discordUserId, t.occurredAt),
    check(
      "raw_voice_events_event_type_check",
      sql.raw(`${t.eventType.name} in (${rawVoiceEventTypes.map((v) => `'${v}'`).join(", ")})`),
    ),
    check(
      "raw_voice_events_snowflakes_check",
      sql`${t.discordUserId} ~ ${sql.raw(`'${SNOWFLAKE}'`)}
        and ${t.guildId} ~ ${sql.raw(`'${SNOWFLAKE}'`)}
        and ${t.fromChannelId} ~ ${sql.raw(`'${SNOWFLAKE}'`)}
        and ${t.toChannelId} ~ ${sql.raw(`'${SNOWFLAKE}'`)}`,
    ),
    check(
      "raw_voice_events_shape_check",
      sql`case
        when ${t.eventType} in ('voice_join', 'voice_present') then
          ${t.discordUserId} is not null and ${t.guildId} is not null
          and ${t.fromChannelId} is null and ${t.toChannelId} is not null
        when ${t.eventType} = 'voice_leave' then
          ${t.discordUserId} is not null and ${t.guildId} is not null
          and ${t.fromChannelId} is not null and ${t.toChannelId} is null
        when ${t.eventType} = 'voice_move' then
          ${t.discordUserId} is not null and ${t.guildId} is not null
          and ${t.fromChannelId} is not null and ${t.toChannelId} is not null
          and ${t.fromChannelId} <> ${t.toChannelId}
        else
          ${t.discordUserId} is null and ${t.fromChannelId} is null and ${t.toChannelId} is null
      end`,
    ),
  ],
);

export type RawVoiceEvent = typeof rawVoiceEvents.$inferSelect;
export type NewRawVoiceEvent = Omit<typeof rawVoiceEvents.$inferInsert, "id" | "recordedAt">;
