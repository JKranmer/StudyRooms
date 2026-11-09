// PROTÓTIPO (F1-50). DADOS FALSOS, fixos no código: nada aqui vem de uma conta real nem
// de API. Para remover o protótipo, apague a pasta `src/prototype` e troque o hook do
// dashboard pela consulta real (F1-35 e F1-36).
//
// O formato imita o que o banco guarda: horários em UTC (ISO 8601), registros brutos
// preservados, eventos de voz no formato de `raw_voice_events` (packages/db), sem mudo nem
// transmissão. O fuso do perfil só é aplicado na leitura. Sessões manuais e de timer ainda
// não têm tabela (ADR 0005 pendente): o formato delas aqui é só uma aproximação.
//
// Os dados são gerados por um PRNG com semente fixa: o resultado é sempre o mesmo.

import { addDays, civil, dateKey, fromLocal, type CivilDate } from '@/prototype/calculations';

/** "Agora" fixo do protótipo: 9 nov. 2026, 12:00 em São Paulo. */
export const SIMULATED_NOW_MS = Date.parse('2026-11-09T15:00:00.000Z');
export const SIMULATED_TIME_ZONE = 'America/Sao_Paulo';

export const SIMULATED_DISCORD_USER_ID = '400000000000000001';

export interface SimulatedGuild {
  guildId: string;
  name: string;
  studyChannelIds: string[];
  afkChannelId: string;
}

export const SIMULATED_GUILDS: SimulatedGuild[] = [
  {
    guildId: '100000000000000001',
    name: 'Estudos BR (simulado)',
    studyChannelIds: ['200000000000000001', '200000000000000002'],
    afkChannelId: '200000000000000009',
  },
  {
    guildId: '100000000000000002',
    name: 'Grupo de Cálculo (simulado)',
    studyChannelIds: ['300000000000000001'],
    afkChannelId: '300000000000000009',
  },
];

export interface SimulatedSession {
  id: string;
  origin: 'manual' | 'timer';
  startedAt: string;
  /** No timer, é o último sinal recebido. */
  endedAt: string;
}

/** Mesmo formato de `raw_voice_events`, com os horários em ISO 8601 UTC. */
export interface SimulatedVoiceEvent {
  idempotencyKey: string;
  eventType: 'voice_join' | 'voice_leave' | 'voice_move';
  discordUserId: string;
  guildId: string;
  fromChannelId: string | null;
  toChannelId: string | null;
  occurredAt: string;
  recordedAt: string;
}

// mulberry32: pequeno e determinístico.
function createRandom(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function generate() {
  const random = createRandom(20261109);
  const between = (min: number, max: number) => Math.floor(min + random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const uuid = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
  };
  const iso = (ms: number) => new Date(ms).toISOString();

  const sessions: SimulatedSession[] = [];
  const voiceEvents: SimulatedVoiceEvent[] = [];
  let sessionCounter = 0;

  const addSession = (origin: SimulatedSession['origin'], startMs: number, endMs: number) => {
    sessionCounter += 1;
    sessions.push({ id: `sim-${String(sessionCounter)}`, origin, startedAt: iso(startMs), endedAt: iso(endMs) });
  };

  const voice = (
    eventType: SimulatedVoiceEvent['eventType'],
    guild: SimulatedGuild,
    atMs: number,
    fromChannelId: string | null,
    toChannelId: string | null,
  ) => {
    voiceEvents.push({
      idempotencyKey: uuid(),
      eventType,
      discordUserId: SIMULATED_DISCORD_USER_ID,
      guildId: guild.guildId,
      fromChannelId,
      toChannelId,
      occurredAt: iso(atMs),
      recordedAt: iso(atMs + between(1, 4) * 1000),
    });
  };

  /** Uma ida à call: entrada, às vezes troca de canal ou pausa no AFK, e saída. */
  const addVoiceSession = (startMs: number, endMs: number) => {
    const guild = pick(SIMULATED_GUILDS);
    const channel = pick(guild.studyChannelIds);
    voice('voice_join', guild, startMs, null, channel);
    const middle = startMs + Math.floor((endMs - startMs) / 2);
    const roll = random();
    let last = channel;
    if (roll < 0.3 && endMs - startMs > 40 * 60_000) {
      // Pausa no AFK: fica fora do cálculo.
      voice('voice_move', guild, middle, channel, guild.afkChannelId);
      voice('voice_move', guild, middle + 15 * 60_000, guild.afkChannelId, channel);
    } else if (roll < 0.5 && guild.studyChannelIds.length > 1) {
      last = guild.studyChannelIds.find((id) => id !== channel) ?? channel;
      voice('voice_move', guild, middle, channel, last);
    }
    voice('voice_leave', guild, endMs, last, null);
  };

  const tz = SIMULATED_TIME_ZONE;
  const firstDay: CivilDate = civil(2026, 3, 2);
  const lastFullDay: CivilDate = civil(2026, 11, 8);
  /** O bot entrou no servidor nesta data: não há histórico de voz antes dela. */
  const botJoinedKey = '2026-10-05';
  /** A semana atual e a anterior têm estudo todo dia, para a streak aparecer. */
  const alwaysStudyFromKey = '2026-10-28';

  for (let day = firstDay; dateKey(day) <= dateKey(lastFullDay); day = addDays(day, 1)) {
    const key = dateKey(day);
    if (key < alwaysStudyFromKey && random() < 0.22) continue;

    const slots: [number, number][] = [];
    if (random() < 0.55) slots.push([between(7, 9), between(0, 3) * 15]);
    if (random() < 0.3) slots.push([between(14, 16), between(0, 3) * 15]);
    if (slots.length === 0 || random() < 0.7) slots.push([between(19, 22), between(0, 3) * 15]);

    for (const [hour, minute] of slots) {
      const startMs = fromLocal(tz, day.year, day.month, day.day, hour, minute);
      // Às vezes a noite passa da meia-noite.
      const crossesMidnight = hour >= 22 && random() < 0.4;
      const durationMin = crossesMidnight ? between(90, 150) : between(20, 120);
      const endMs = startMs + durationMin * 60_000;

      const roll = random();
      if (key >= botJoinedKey && roll < 0.55) addVoiceSession(startMs, endMs);
      else if (roll < 0.85) addSession('timer', startMs, endMs);
      else addSession('manual', startMs, endMs);
    }
  }

  // Ontem: timer aberto no site durante a call. A sobreposição conta uma vez.
  const yesterday = lastFullDay;
  const overlapStart = fromLocal(tz, yesterday.year, yesterday.month, yesterday.day, 15, 0);
  addVoiceSession(overlapStart, overlapStart + 90 * 60_000);
  addSession('timer', overlapStart + 30 * 60_000, overlapStart + 120 * 60_000);

  // Hoje, até agora: só 10 min, registrados à mão. Hoje ainda não conta, mas não quebra.
  const todayStart = fromLocal(tz, 2026, 11, 9, 8, 0);
  addSession('manual', todayStart, todayStart + 10 * 60_000);

  return { sessions, voiceEvents };
}

const generated = generate();

export const SIMULATED_SESSIONS: readonly SimulatedSession[] = generated.sessions;
export const SIMULATED_VOICE_EVENTS: readonly SimulatedVoiceEvent[] = generated.voiceEvents;
