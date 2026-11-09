import { rawVoiceEventTypes, type NewRawVoiceEvent, type RawVoiceEventType } from "@studyrooms/db";
import type { PresenceChange } from "./presence.ts";
import type { VoiceEventType } from "./voice-event.ts";

type BotEventType = Extract<RawVoiceEventType, `bot_${string}`>;

/** Evento observado pelo bot, antes de receber a chave de idempotência. */
export type RawEventInput = {
  eventType: RawVoiceEventType;
  guildId: string | null;
  discordUserId: string | null;
  fromChannelId: string | null;
  toChannelId: string | null;
  /** Horário do fato, ou da detecção quando o fato aconteceu durante uma queda. */
  occurredAt: Date;
};

/** Forma gravada na fila em disco (uma linha JSON): o horário vai como ISO em UTC. */
export type QueuedEvent = Omit<RawEventInput, "occurredAt"> & { idempotencyKey: string; occurredAt: string };

function userEvent(
  eventType: RawVoiceEventType,
  guildId: string,
  userId: string,
  from: string | null,
  to: string | null,
  at: Date,
): RawEventInput {
  return { eventType, guildId, discordUserId: userId, fromChannelId: from, toChannelId: to, occurredAt: at };
}

/** Evento de voz recebido do Discord. `ignore` (mudo, transmissão, quem não consentiu) não gera nada. */
export function eventFromTransition(
  guildId: string,
  userId: string,
  type: VoiceEventType,
  oldChannelId: string | null | undefined,
  newChannelId: string | null,
  at: Date,
): RawEventInput | null {
  switch (type) {
    case "join":
      return newChannelId ? userEvent("voice_join", guildId, userId, null, newChannelId, at) : null;
    case "seen":
      return newChannelId ? userEvent("voice_present", guildId, userId, null, newChannelId, at) : null;
    case "leave":
      return oldChannelId ? userEvent("voice_leave", guildId, userId, oldChannelId, null, at) : null;
    case "move":
      return oldChannelId && newChannelId
        ? userEvent("voice_move", guildId, userId, oldChannelId, newChannelId, at)
        : null;
    case "ignore":
      return null;
  }
}

/**
 * Diferença encontrada na reconciliação (início ou volta de uma queda). O horário é o da detecção:
 * o marco `bot_disconnect` anterior diz desde quando o bot não enxergava (ADR 0007, F1-08).
 */
export function eventFromChange(guildId: string, change: PresenceChange, at: Date): RawEventInput {
  switch (change.kind) {
    case "already":
    case "still":
    case "joined_gap":
      return userEvent("voice_present", guildId, change.userId, null, change.channelId, at);
    case "left_gap":
      return userEvent("voice_leave", guildId, change.userId, change.oldChannelId, null, at);
    case "moved_gap":
      return userEvent("voice_move", guildId, change.userId, change.oldChannelId, change.channelId, at);
  }
}

export function botMarker(eventType: BotEventType, at: Date): RawEventInput {
  return { eventType, guildId: null, discordUserId: null, fromChannelId: null, toChannelId: null, occurredAt: at };
}

export function toQueuedEvent(input: RawEventInput, idempotencyKey: string): QueuedEvent {
  return { idempotencyKey, ...input, occurredAt: input.occurredAt.toISOString() };
}

export function toRow(event: QueuedEvent): NewRawVoiceEvent {
  return {
    idempotencyKey: event.idempotencyKey,
    eventType: event.eventType,
    guildId: event.guildId,
    discordUserId: event.discordUserId,
    fromChannelId: event.fromChannelId,
    toChannelId: event.toChannelId,
    occurredAt: new Date(event.occurredAt),
  };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EVENT_TYPES: ReadonlySet<string> = new Set(rawVoiceEventTypes);

function optionalText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Lê uma linha da fila. Só confere a forma; as regras de conteúdo (snowflakes, combinação de
 * campos) são do banco, e uma linha recusada por ele vai para a quarentena.
 */
export function parseQueuedEvent(value: unknown): QueuedEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.idempotencyKey !== "string" || typeof v.eventType !== "string") return null;
  if (!EVENT_TYPES.has(v.eventType)) return null;
  if (typeof v.occurredAt !== "string" || !ISO_UTC.test(v.occurredAt)) return null;
  if (Number.isNaN(Date.parse(v.occurredAt))) return null;
  const { guildId, discordUserId, fromChannelId, toChannelId } = v;
  if (![guildId, discordUserId, fromChannelId, toChannelId].every(optionalText)) return null;
  return {
    idempotencyKey: v.idempotencyKey,
    eventType: v.eventType as RawVoiceEventType,
    guildId: guildId as string | null,
    discordUserId: discordUserId as string | null,
    fromChannelId: fromChannelId as string | null,
    toChannelId: toChannelId as string | null,
    occurredAt: v.occurredAt,
  };
}
