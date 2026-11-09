import { VoicePresence, type PresenceChange, type VoiceStateView } from "./presence.ts";
import { botMarker, eventFromChange, eventFromTransition, type RawEventInput } from "./raw-event.ts";
import { formatVoiceLogLine, type ChannelRef, type VoiceLogEntry } from "./voice-event.ts";

/** O que os handlers precisam de um servidor; o `index.ts` adapta o `Guild` do discord.js. */
export type GuildView = {
  id: string;
  available: boolean;
  channelName(channelId: string): string | null;
  voiceStates(): Iterable<VoiceStateView>;
};

export type BotHandlersDeps = {
  allowlist: ReadonlySet<string>;
  log(line: string): void;
  now(): Date;
  /** Leva o evento para a fila do banco. Só recebe eventos de quem está na lista de consentimento. */
  record(event: RawEventInput): void;
};

type Outage = { startedAt: Date; attempts: number; errorCodes: Set<string> };

export function createBotHandlers({ allowlist, log, now, record: recordEvent }: BotHandlersDeps) {
  const presence = new VoicePresence(allowlist);
  let started = false;
  let stopped = false;
  // O spike usa um único shard; com mais de um, este estado teria de ser por shard.
  let outage: Outage | null = null;

  // Depois do stop, nada mais vai para a fila além do próprio bot_stop.
  function record(event: RawEventInput | null): void {
    if (event && !stopped) recordEvent(event);
  }

  function channel(guild: GuildView, id: string): ChannelRef {
    return { id, name: guild.channelName(id) };
  }

  function logChange(guild: GuildView, change: PresenceChange): void {
    const { userId } = change;
    const at = now();
    let entry: VoiceLogEntry;
    switch (change.kind) {
      case "already":
      case "still":
      case "joined_gap":
        entry = { type: change.kind, at, userId, newChannel: channel(guild, change.channelId) };
        break;
      case "left_gap":
        entry = { type: "left_gap", at, userId, oldChannel: channel(guild, change.oldChannelId) };
        break;
      case "moved_gap":
        entry = {
          type: "moved_gap",
          at,
          userId,
          oldChannel: channel(guild, change.oldChannelId),
          newChannel: channel(guild, change.channelId),
        };
        break;
    }
    log(formatVoiceLogLine(entry));
    record(eventFromChange(guild.id, change, at));
  }

  function reconcile(guild: GuildView): PresenceChange[] {
    const changes = presence.reconcile(guild.id, guild.voiceStates());
    for (const change of changes) logChange(guild, change);
    return changes;
  }

  function endOutage(mode: "resume" | "identify", replayed: number): void {
    if (!outage) return;
    const at = now();
    const seconds = Math.round((at.getTime() - outage.startedAt.getTime()) / 1000);
    record(botMarker("bot_resume", at));
    log(
      `${at.toISOString()} retomada modo=${mode} reenviados=${replayed}` +
        ` tentativas=${outage.attempts} desde_deteccao_s=${seconds}`,
    );
    outage = null;
  }

  return {
    onClientReady(guilds: Iterable<GuildView>): void {
      started = true;
      record(botMarker("bot_start", now()));
      let inCall = 0;
      let unavailable = 0;
      for (const guild of guilds) {
        if (!guild.available) {
          unavailable += 1;
          continue;
        }
        inCall += reconcile(guild).filter((change) => change.kind === "already").length;
      }
      log(`[bot] estado inicial: ${inCall} da allowlist em call.`);
      if (unavailable > 0) {
        log(`[bot] aviso: ${unavailable} servidor(es) indisponível(is); o estado deles virá quando voltarem.`);
      }
    },

    /**
     * O discord.js chama isto a cada GUILD_CREATE, inclusive em nova sessão após uma queda, quando
     * ele troca o cache de voz sem emitir `voiceStateUpdate`. Antes do `clientReady`, é ele quem lê.
     */
    onGuildAvailable(guild: GuildView): void {
      if (started) reconcile(guild);
    },

    onVoiceState(guild: GuildView, userId: string, newChannelId: string | null): void {
      const { type, oldChannelId } = presence.observe(guild.id, userId, newChannelId);
      if (stopped) return;
      const at = now();
      record(eventFromTransition(guild.id, userId, type, oldChannelId, newChannelId, at));
      const context = { at, userId, ...(outage ? { arrival: true } : {}) };
      if ((type === "join" || type === "seen") && newChannelId) {
        log(formatVoiceLogLine({ ...context, type, newChannel: channel(guild, newChannelId) }));
      } else if (type === "leave" && oldChannelId) {
        log(formatVoiceLogLine({ ...context, type, oldChannel: channel(guild, oldChannelId) }));
      } else if (type === "move" && oldChannelId && newChannelId) {
        log(
          formatVoiceLogLine({
            ...context,
            type,
            oldChannel: channel(guild, oldChannelId),
            newChannel: channel(guild, newChannelId),
          }),
        );
      }
    },

    /** Dispara a cada tentativa: em uma queda longa, várias vezes por minuto. */
    onReconnecting(): void {
      if (stopped) return;
      if (outage) {
        outage.attempts += 1;
        return;
      }
      const startedAt = now();
      outage = { startedAt, attempts: 1, errorCodes: new Set() };
      record(botMarker("bot_disconnect", startedAt));
      log(`${startedAt.toISOString()} queda detectada; reconectando (horário da detecção, não da queda)`);
    },

    /** Só o código é impresso: a mensagem do erro é de terceiros e pode trazer qualquer coisa. */
    onShardError(error: { code?: unknown; name?: unknown }): void {
      if (stopped) return;
      const code = String(error.code ?? error.name ?? "desconhecido");
      if (outage?.errorCodes.has(code)) return;
      outage?.errorCodes.add(code);
      log(`[bot] erro de conexão (código: ${code}).`);
    },

    onResume(replayed: number): void {
      endOutage("resume", replayed);
    },

    onShardReady(): void {
      endOutage("identify", 0);
    },

    onDisconnect(code: number): void {
      if (stopped) return;
      log(`[bot] erro: o Discord encerrou a conexão sem permitir reconexão (código: ${code}).`);
    },

    /** Encerramento: grava o bot_stop (se o bot chegou a conectar) e para de gravar e de logar. */
    stop(): void {
      if (stopped) return;
      if (started) record(botMarker("bot_stop", now()));
      stopped = true;
    },
  };
}
