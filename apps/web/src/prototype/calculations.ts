// PROTÓTIPO (F1-50). Lógica PROVISÓRIA, só para o dashboard simulado ter números coerentes.
// Em produção, a união de intervalos, o fatiamento por dia e hora no fuso do usuário e a
// streak vêm de packages/shared (com TDD) e chegam prontos pela API. Não reaproveite este
// arquivo: ele é apagado junto com `src/prototype`, e as regras finais saem dos ADRs 0005,
// 0006 e 0007.

import type { DashboardData, PeriodBucket, PeriodKind, RecentSession } from '@/dashboard/types';

const MINUTE = 60_000;
export const STREAK_THRESHOLD_MINUTES = 15;

export interface Interval {
  startMs: number;
  endMs: number;
}

// ---------------------------------------------------------------------------------------
// Fuso horário (só Intl, sem biblioteca)
// ---------------------------------------------------------------------------------------

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function toLocalParts(ms: number, timeZone: string): LocalParts {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function offsetMs(ms: number, timeZone: string) {
  const p = toLocalParts(ms, timeZone);
  const whole = Math.floor(ms / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/** Instante UTC de um horário local. Aceita estouro (dia 32, hora 24), como `Date.UTC`. */
export function fromLocal(timeZone: string, year: number, month: number, day: number, hour = 0, minute = 0) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - offsetMs(asUtc, timeZone);
  return asUtc - offsetMs(first, timeZone);
}

// ---------------------------------------------------------------------------------------
// Datas de calendário (`AAAA-MM-DD`, sem fuso)
// ---------------------------------------------------------------------------------------

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function civil(year: number, month: number, day: number): CivilDate {
  const d = new Date(Date.UTC(year, month - 1, day));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function dateKey({ year, month, day }: CivilDate) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(date: CivilDate, days: number) {
  return civil(date.year, date.month, date.day + days);
}

/** 0 = domingo. */
export function weekday(date: CivilDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function localDate(ms: number, timeZone: string): CivilDate {
  const p = toLocalParts(ms, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

// ---------------------------------------------------------------------------------------
// Intervalos
// ---------------------------------------------------------------------------------------

/** União dos intervalos: tempo sobreposto entre origens conta uma vez. */
export function unionIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.endMs > i.startMs).toSorted((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged.at(-1);
    if (last && current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export interface HourSlice {
  date: string;
  weekday: number;
  hour: number;
  ms: number;
}

/** Corta um intervalo nas viradas de hora local; quem cruza a meia-noite cai nos dois dias. */
export function sliceByLocalHour(interval: Interval, timeZone: string): HourSlice[] {
  const slices: HourSlice[] = [];
  let t = interval.startMs;
  while (t < interval.endMs) {
    const p = toLocalParts(t, timeZone);
    // Próxima virada de hora local a partir das partes locais: não depende de converter um
    // horário local que pode não existir (início do horário de verão, meia-noite pulada).
    const next = t - (p.minute * 60 + p.second) * 1000 - (t % 1000) + 3_600_000;
    const end = Math.min(next, interval.endMs);
    const date = { year: p.year, month: p.month, day: p.day };
    slices.push({ date: dateKey(date), weekday: weekday(date), hour: p.hour, ms: end - t });
    t = end;
  }
  return slices;
}

// ---------------------------------------------------------------------------------------
// Voz: eventos brutos viram intervalos (regra provisória; a final é do ADR 0005)
// ---------------------------------------------------------------------------------------

export interface VoiceEventLike {
  eventType: string;
  discordUserId: string | null;
  guildId: string | null;
  fromChannelId: string | null;
  toChannelId: string | null;
  /** ISO 8601 em UTC. */
  occurredAt: string;
}

export interface VoiceInterval extends Interval {
  guildId: string;
}

/**
 * Pareia entrada e saída por pessoa e servidor. Ir para o canal AFK fecha o intervalo, e
 * sair dele reabre. Sessão sem saída fica de fora: o fechamento de órfãs é do ADR 0007.
 */
export function voiceEventsToIntervals(events: readonly VoiceEventLike[], afkChannelIds: ReadonlySet<string>) {
  const open = new Map<string, { startMs: number; guildId: string }>();
  const intervals: VoiceInterval[] = [];
  const sorted = events.toSorted((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  for (const event of sorted) {
    if (!event.discordUserId || !event.guildId) continue;
    const key = `${event.discordUserId}:${event.guildId}`;
    const at = Date.parse(event.occurredAt);
    const close = () => {
      const started = open.get(key);
      if (started) intervals.push({ startMs: started.startMs, endMs: at, guildId: started.guildId });
      open.delete(key);
    };
    const openIfStudying = (channelId: string | null) => {
      if (channelId && !afkChannelIds.has(channelId) && !open.has(key)) {
        open.set(key, { startMs: at, guildId: event.guildId ?? '' });
      }
    };

    if (event.eventType === 'voice_join' || event.eventType === 'voice_present') {
      openIfStudying(event.toChannelId);
    } else if (event.eventType === 'voice_leave') {
      close();
    } else if (event.eventType === 'voice_move') {
      if (event.toChannelId && afkChannelIds.has(event.toChannelId)) close();
      else openIfStudying(event.toChannelId);
    }
  }
  return intervals;
}

// ---------------------------------------------------------------------------------------
// Períodos de calendário (semana de domingo a sábado)
// ---------------------------------------------------------------------------------------

export interface PeriodRange {
  start: CivilDate;
  /** Exclusivo. */
  end: CivilDate;
}

export function periodRange(kind: PeriodKind, today: CivilDate): PeriodRange {
  const { year, month } = today;
  switch (kind) {
    case 'semana': {
      const start = addDays(today, -weekday(today));
      return { start, end: addDays(start, 7) };
    }
    case 'mes':
      return { start: civil(year, month, 1), end: civil(year, month + 1, 1) };
    case 'trimestre': {
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return { start: civil(year, first, 1), end: civil(year, first + 3, 1) };
    }
    case 'semestre': {
      const first = month <= 6 ? 1 : 7;
      return { start: civil(year, first, 1), end: civil(year, first + 6, 1) };
    }
    case 'ano':
      return { start: civil(year, 1, 1), end: civil(year + 1, 1, 1) };
  }
}

export function previousPeriodRange(kind: PeriodKind, range: PeriodRange): PeriodRange {
  return periodRange(kind, addDays(range.start, -1));
}

// ---------------------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------------------

/** O dia conta com 15 min (minutos sem arredondar); hoje só quebra a streak quando termina. */
export function computeStreak(minutesByDate: ReadonlyMap<string, number>, today: CivilDate) {
  const counts = (date: CivilDate) => (minutesByDate.get(dateKey(date)) ?? 0) >= STREAK_THRESHOLD_MINUTES;

  let current = 0;
  let cursor = counts(today) ? today : addDays(today, -1);
  while (counts(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  let best = 0;
  let run = 0;
  let previous: string | undefined;
  const countedKeys = [...minutesByDate.entries()]
    .filter(([key, minutes]) => minutes >= STREAK_THRESHOLD_MINUTES && key <= dateKey(today))
    .map(([key]) => key)
    .toSorted();
  for (const key of countedKeys) {
    const [y = 0, m = 0, d = 0] = key.split('-').map(Number);
    run = previous === dateKey(addDays(civil(y, m, d), -1)) ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }

  return { current, best: Math.max(best, current) };
}

// ---------------------------------------------------------------------------------------
// Montagem do modelo do dashboard
// ---------------------------------------------------------------------------------------

export interface DashboardSource {
  timeZone: string;
  nowMs: number;
  /** Intervalos de todas as origens, já sem AFK, com os registros brutos preservados. */
  intervals: Interval[];
  recentSessions: RecentSession[];
}

function sumBetween(minutesByDate: ReadonlyMap<string, number>, from: string, toExclusive: string) {
  let total = 0;
  for (const [key, minutes] of minutesByDate) if (key >= from && key < toExclusive) total += minutes;
  return total;
}

function buildBuckets(kind: PeriodKind, range: PeriodRange, today: CivilDate, minutesByDate: ReadonlyMap<string, number>) {
  const todayKey = dateKey(today);
  const endKey = dateKey(range.end);
  const buckets: PeriodBucket[] = [];
  const short = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });
  const long = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const monthShort = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'short' });
  const monthLong = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const dayMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const asDate = (d: CivilDate) => Date.UTC(d.year, d.month - 1, d.day);

  if (kind === 'semana' || kind === 'mes') {
    for (let d = range.start; dateKey(d) < endKey; d = addDays(d, 1)) {
      const key = dateKey(d);
      buckets.push({
        key,
        label: kind === 'semana' ? short.format(asDate(d)).replace('.', '') : String(d.day),
        longLabel: long.format(asDate(d)),
        minutes: minutesByDate.get(key) ?? 0,
        isFuture: key > todayKey,
      });
    }
  } else if (kind === 'trimestre') {
    // Semanas de domingo a sábado, cortadas nas bordas do trimestre.
    let start = range.start;
    while (dateKey(start) < endKey) {
      const nextSunday = addDays(start, 7 - weekday(start));
      const end = dateKey(nextSunday) < endKey ? nextSunday : range.end;
      const lastDay = addDays(end, -1);
      buckets.push({
        key: dateKey(start),
        label: dayMonth.format(asDate(start)).replace('.', ''),
        longLabel: `Semana de ${dayMonth.format(asDate(start))} a ${dayMonth.format(asDate(lastDay))}`,
        minutes: sumBetween(minutesByDate, dateKey(start), dateKey(end)),
        isFuture: dateKey(start) > todayKey,
      });
      start = end;
    }
  } else {
    for (let d = range.start; dateKey(d) < endKey; d = civil(d.year, d.month + 1, 1)) {
      const next = civil(d.year, d.month + 1, 1);
      buckets.push({
        key: dateKey(d),
        label: monthShort.format(asDate(d)).replace('.', ''),
        longLabel: monthLong.format(asDate(d)),
        minutes: sumBetween(minutesByDate, dateKey(d), dateKey(next)),
        isFuture: dateKey(d) > todayKey,
      });
    }
  }
  return buckets;
}

export function buildDashboard(kind: PeriodKind, source: DashboardSource): DashboardData {
  const { timeZone, nowMs } = source;
  const today = localDate(nowMs, timeZone);
  const range = periodRange(kind, today);
  const previous = previousPeriodRange(kind, range);
  const startKey = dateKey(range.start);
  const endKey = dateKey(range.end);

  const msByDate = new Map<string, number>();
  const heatmapMs = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const interval of unionIntervals(source.intervals)) {
    for (const slice of sliceByLocalHour(interval, timeZone)) {
      msByDate.set(slice.date, (msByDate.get(slice.date) ?? 0) + slice.ms);
      if (slice.date >= startKey && slice.date < endKey) {
        const row = heatmapMs[slice.weekday];
        if (row) row[slice.hour] = (row[slice.hour] ?? 0) + slice.ms;
      }
    }
  }
  const minutesByDate = new Map([...msByDate].map(([key, ms]) => [key, Math.round(ms / MINUTE)]));
  // O mínimo de 15 min é comparado sem arredondar: 14 min 30 s não conta (D-04).
  const exactMinutesByDate = new Map([...msByDate].map(([key, ms]) => [key, ms / MINUTE]));
  const todayExactMinutes = exactMinutesByDate.get(dateKey(today)) ?? 0;

  let countedDays = 0;
  for (const [key, ms] of msByDate) {
    if (key >= startKey && key < endKey && ms >= STREAK_THRESHOLD_MINUTES * MINUTE) countedDays += 1;
  }

  return {
    timeZone,
    period: { kind, startDate: startKey, endDate: dateKey(addDays(range.end, -1)) },
    totalMinutes: sumBetween(minutesByDate, startKey, endKey),
    previousTotalMinutes: sumBetween(minutesByDate, dateKey(previous.start), dateKey(previous.end)),
    countedDays,
    buckets: buildBuckets(kind, range, today, minutesByDate),
    heatmap: heatmapMs.map((row) => row.map((ms) => Math.round(ms / MINUTE))),
    streak: {
      ...computeStreak(exactMinutesByDate, today),
      // Para baixo, para "hoje" nunca exibir 15 min sem ter chegado ao mínimo.
      todayMinutes: Math.floor(todayExactMinutes),
      thresholdMinutes: STREAK_THRESHOLD_MINUTES,
    },
    recentSessions: source.recentSessions,
  };
}
