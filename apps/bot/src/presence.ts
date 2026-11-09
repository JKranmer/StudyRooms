import { classifyVoiceEvent, type VoiceEventType } from "./voice-event.ts";

export type VoiceStateView = { userId: string; channelId: string | null };

export type VoiceTransition = {
  type: VoiceEventType;
  oldChannelId: string | null | undefined;
  newChannelId: string | null;
};

export type PresenceChange =
  | { kind: "already" | "still" | "joined_gap"; userId: string; channelId: string }
  | { kind: "left_gap"; userId: string; oldChannelId: string }
  | { kind: "moved_gap"; userId: string; oldChannelId: string; channelId: string };

/**
 * Quem da allowlist está em qual canal, por servidor. Só guarda quem está na allowlist.
 *
 * O cache do discord.js não serve para isso: uma nova sessão o substitui sem emitir eventos, e
 * ele não distingue "não estava em canal" de "ainda não sei", o que gerava o `entrou` falso.
 */
export class VoicePresence {
  readonly #allowlist: ReadonlySet<string>;
  readonly #channels = new Map<string, Map<string, string>>();
  readonly #loadedGuilds = new Set<string>();

  constructor(allowlist: ReadonlySet<string>) {
    this.#allowlist = allowlist;
  }

  observe(guildId: string, userId: string, newChannelId: string | null): VoiceTransition {
    const channels = this.#guildChannels(guildId);
    const tracked = channels.get(userId);
    const fallback = this.#loadedGuilds.has(guildId) ? null : undefined;
    const oldChannelId = tracked ?? fallback;
    const type = classifyVoiceEvent({
      userId,
      allowlist: this.#allowlist,
      oldChannelId,
      newChannelId,
    });
    if (this.#allowlist.has(userId)) {
      if (newChannelId === null) channels.delete(userId);
      else channels.set(userId, newChannelId);
    }
    return { type, oldChannelId, newChannelId };
  }

  /** Recebe o estado completo do servidor e devolve o que difere do acompanhado até aqui. */
  reconcile(guildId: string, states: Iterable<VoiceStateView>): PresenceChange[] {
    const firstLoad = !this.#loadedGuilds.has(guildId);
    const previous = this.#guildChannels(guildId);
    const current = new Map<string, string>();
    for (const { userId, channelId } of states) {
      if (channelId !== null && this.#allowlist.has(userId)) current.set(userId, channelId);
    }

    const changes: PresenceChange[] = [];
    for (const [userId, oldChannelId] of previous) {
      if (!current.has(userId)) changes.push({ kind: "left_gap", userId, oldChannelId });
    }
    for (const [userId, channelId] of current) {
      const oldChannelId = previous.get(userId);
      if (oldChannelId === undefined) {
        changes.push({ kind: firstLoad ? "already" : "joined_gap", userId, channelId });
      } else if (oldChannelId === channelId) {
        changes.push({ kind: "still", userId, channelId });
      } else {
        changes.push({ kind: "moved_gap", userId, oldChannelId, channelId });
      }
    }

    this.#channels.set(guildId, current);
    this.#loadedGuilds.add(guildId);
    return changes;
  }

  #guildChannels(guildId: string): Map<string, string> {
    let channels = this.#channels.get(guildId);
    if (!channels) {
      channels = new Map();
      this.#channels.set(guildId, channels);
    }
    return channels;
  }
}
