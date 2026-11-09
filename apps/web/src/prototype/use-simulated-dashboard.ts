// PROTÓTIPO (F1-50). Monta o dashboard a partir dos dados falsos, sem rede. Fica no
// TanStack Query para a tela já tratar carregamento, erro e vazio como fará com a API:
// na F1-35, este hook é trocado pela consulta real, e o resto do dashboard continua igual.

import { useQuery } from '@tanstack/react-query';

import type { DashboardData, PeriodKind, RecentSession } from '@/dashboard/types';
import { buildDashboard, voiceEventsToIntervals, type Interval } from '@/prototype/calculations';
import {
  SIMULATED_GUILDS,
  SIMULATED_NOW_MS,
  SIMULATED_SESSIONS,
  SIMULATED_TIME_ZONE,
  SIMULATED_VOICE_EVENTS,
} from '@/prototype/simulated-data';

const RECENT_LIMIT = 8;

export function buildSimulatedDashboard(kind: PeriodKind): DashboardData {
  const afk = new Set(SIMULATED_GUILDS.map((guild) => guild.afkChannelId));
  const guildNames = new Map(SIMULATED_GUILDS.map((guild) => [guild.guildId, guild.name]));

  const sessions: RecentSession[] = SIMULATED_SESSIONS.map((session) => ({
    id: session.id,
    origin: session.origin,
    startMs: Date.parse(session.startedAt),
    endMs: Date.parse(session.endedAt),
  }));
  const voice: RecentSession[] = voiceEventsToIntervals(SIMULATED_VOICE_EVENTS, afk).map((interval, index) => ({
    id: `voz-${String(index)}`,
    origin: 'discord',
    startMs: interval.startMs,
    endMs: interval.endMs,
    guildName: guildNames.get(interval.guildId) ?? 'Servidor desconhecido',
  }));
  const all = [...sessions, ...voice].filter((session) => session.endMs <= SIMULATED_NOW_MS);
  const intervals: Interval[] = all.map(({ startMs, endMs }) => ({ startMs, endMs }));

  return buildDashboard(kind, {
    timeZone: SIMULATED_TIME_ZONE,
    nowMs: SIMULATED_NOW_MS,
    intervals,
    recentSessions: all.toSorted((a, b) => b.startMs - a.startMs).slice(0, RECENT_LIMIT),
  });
}

export function useSimulatedDashboard(kind: PeriodKind) {
  return useQuery({
    queryKey: ['prototipo', 'dashboard', kind],
    queryFn: () => Promise.resolve(buildSimulatedDashboard(kind)),
    staleTime: Infinity,
  });
}
