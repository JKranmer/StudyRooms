import { describe, expect, it } from 'vitest';

import {
  buildDashboard,
  civil,
  computeStreak,
  dateKey,
  fromLocal,
  periodRange,
  sliceByLocalHour,
  unionIntervals,
  voiceEventsToIntervals,
} from '@/prototype/calculations';

const SP = 'America/Sao_Paulo';
const at = (iso: string) => Date.parse(iso);
const min = 60_000;

describe('cálculos provisórios do protótipo', () => {
  it('converte horário local em UTC, inclusive com horário de verão', () => {
    expect(new Date(fromLocal(SP, 2026, 11, 9, 12)).toISOString()).toBe('2026-11-09T15:00:00.000Z');
    expect(new Date(fromLocal('America/New_York', 2026, 7, 1, 12)).toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(new Date(fromLocal('America/New_York', 2026, 12, 1, 12)).toISOString()).toBe('2026-12-01T17:00:00.000Z');
  });

  it('conta uma vez o tempo sobreposto', () => {
    const merged = unionIntervals([
      { startMs: 0, endMs: 60 * min },
      { startMs: 30 * min, endMs: 90 * min },
      { startMs: 120 * min, endMs: 130 * min },
    ]);
    expect(merged).toEqual([
      { startMs: 0, endMs: 90 * min },
      { startMs: 120 * min, endMs: 130 * min },
    ]);
  });

  it('divide a sessão que cruza a meia-noite local entre os dois dias', () => {
    // 23:30 a 00:45 em São Paulo (UTC-3).
    const slices = sliceByLocalHour({ startMs: at('2026-11-08T02:30:00Z'), endMs: at('2026-11-08T03:45:00Z') }, SP);
    expect(slices).toEqual([
      { date: '2026-11-07', weekday: 6, hour: 23, ms: 30 * min },
      { date: '2026-11-08', weekday: 0, hour: 0, ms: 45 * min },
    ]);
  });

  it('tira o canal AFK e pareia entrada e saída por servidor', () => {
    const base = { discordUserId: '400000000000000001', guildId: '100000000000000001' };
    const intervals = voiceEventsToIntervals(
      [
        { ...base, eventType: 'voice_join', fromChannelId: null, toChannelId: '2', occurredAt: '2026-11-08T10:00:00Z' },
        { ...base, eventType: 'voice_move', fromChannelId: '2', toChannelId: 'afk', occurredAt: '2026-11-08T10:30:00Z' },
        { ...base, eventType: 'voice_move', fromChannelId: 'afk', toChannelId: '3', occurredAt: '2026-11-08T10:50:00Z' },
        { ...base, eventType: 'voice_leave', fromChannelId: '3', toChannelId: null, occurredAt: '2026-11-08T11:00:00Z' },
      ],
      new Set(['afk']),
    );
    expect(intervals.map((i) => (i.endMs - i.startMs) / min)).toEqual([30, 10]);
  });

  it('usa semana de domingo a sábado e os períodos de calendário', () => {
    const today = civil(2026, 11, 9); // segunda-feira
    const key = (r: ReturnType<typeof periodRange>) => [dateKey(r.start), dateKey(r.end)];
    expect(key(periodRange('semana', today))).toEqual(['2026-11-08', '2026-11-15']);
    expect(key(periodRange('mes', today))).toEqual(['2026-11-01', '2026-12-01']);
    expect(key(periodRange('trimestre', today))).toEqual(['2026-10-01', '2027-01-01']);
    expect(key(periodRange('semestre', today))).toEqual(['2026-07-01', '2027-01-01']);
    expect(key(periodRange('ano', today))).toEqual(['2026-01-01', '2027-01-01']);
  });

  it('streak: 15 min contam, e hoje sem tempo ainda não quebra', () => {
    const minutes = new Map([
      ['2026-11-05', 30],
      ['2026-11-06', 14],
      ['2026-11-07', 15],
      ['2026-11-08', 60],
      ['2026-11-09', 5],
    ]);
    expect(computeStreak(minutes, civil(2026, 11, 9))).toEqual({ current: 2, best: 2 });
    minutes.set('2026-11-09', 20);
    expect(computeStreak(minutes, civil(2026, 11, 9))).toEqual({ current: 3, best: 3 });
  });

  it('monta o dashboard da semana com o fuso aplicado só na leitura', () => {
    const data = buildDashboard('semana', {
      timeZone: SP,
      nowMs: at('2026-11-09T15:00:00Z'),
      // Domingo, 21:00 a 22:00 local, com timer e call sobrepostos.
      intervals: [
        { startMs: at('2026-11-09T00:00:00Z'), endMs: at('2026-11-09T01:00:00Z') },
        { startMs: at('2026-11-09T00:30:00Z'), endMs: at('2026-11-09T01:00:00Z') },
      ],
      recentSessions: [],
    });
    expect(data.totalMinutes).toBe(60);
    expect(data.buckets[0]).toMatchObject({ key: '2026-11-08', minutes: 60, isFuture: false });
    expect(data.buckets[6]).toMatchObject({ key: '2026-11-14', isFuture: true });
    expect(data.heatmap[0]?.[21]).toBe(60);
    expect(data.streak).toMatchObject({ current: 1, todayMinutes: 0 });
  });
});
