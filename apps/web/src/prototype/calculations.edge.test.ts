// Theo (QA), F1-50: casos de borda dos cálculos provisórios do protótipo.
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
  type VoiceEventLike,
} from '@/prototype/calculations';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
const min = 60_000;
const hour = 60 * min;
const sum = (xs: { ms: number }[]) => xs.reduce((s, x) => s + x.ms, 0);

const base = { discordUserId: 'u1', guildId: 'g1' };
const ev = (
  eventType: string,
  occurredAt: string,
  fromChannelId: string | null,
  toChannelId: string | null,
  extra: Partial<VoiceEventLike> = {},
): VoiceEventLike => ({ ...base, eventType, occurredAt, fromChannelId, toChannelId, ...extra });
const AFK = new Set(['afk']);

describe('união de intervalos: bordas', () => {
  it('intervalos encostados viram um só; contidos e idênticos contam uma vez', () => {
    expect(
      unionIntervals([
        { startMs: 0, endMs: hour },
        { startMs: hour, endMs: 2 * hour },
        { startMs: 10 * min, endMs: 20 * min },
        { startMs: 0, endMs: hour },
      ]),
    ).toEqual([{ startMs: 0, endMs: 2 * hour }]);
  });

  it('descarta intervalos vazios ou invertidos e aceita lista vazia', () => {
    expect(unionIntervals([])).toEqual([]);
    expect(
      unionIntervals([
        { startMs: 5, endMs: 5 },
        { startMs: 10, endMs: 1 },
      ]),
    ).toEqual([]);
  });

  it('não altera a entrada (dado bruto preservado)', () => {
    const input = [
      { startMs: 0, endMs: 10 },
      { startMs: 5, endMs: 20 },
    ];
    const copy = structuredClone(input);
    unionIntervals(input);
    expect(input).toEqual(copy);
  });
});

describe('voz: AFK, eventos repetidos e sessões órfãs', () => {
  it('entrada direto no AFK não abre sessão; saída do AFK sem retorno não soma', () => {
    const intervals = voiceEventsToIntervals(
      [ev('voice_join', '2026-11-08T10:00:00Z', null, 'afk'), ev('voice_leave', '2026-11-08T11:00:00Z', 'afk', null)],
      AFK,
    );
    expect(intervals).toEqual([]);
  });

  it('entrada repetida não reinicia a sessão; saída repetida não cria intervalo', () => {
    const intervals = voiceEventsToIntervals(
      [
        ev('voice_join', '2026-11-08T10:00:00Z', null, 'c1'),
        ev('voice_join', '2026-11-08T10:20:00Z', null, 'c1'),
        ev('voice_leave', '2026-11-08T11:00:00Z', 'c1', null),
        ev('voice_leave', '2026-11-08T11:05:00Z', 'c1', null),
      ],
      AFK,
    );
    expect(intervals.map((i) => (i.endMs - i.startMs) / min)).toEqual([60]);
  });

  it('sessão órfã (sem saída) fica de fora; saída sem entrada é ignorada', () => {
    expect(voiceEventsToIntervals([ev('voice_join', '2026-11-08T10:00:00Z', null, 'c1')], AFK)).toEqual([]);
    expect(voiceEventsToIntervals([ev('voice_leave', '2026-11-08T10:00:00Z', 'c1', null)], AFK)).toEqual([]);
  });

  it('eventos fora de ordem são ordenados por occurredAt', () => {
    const intervals = voiceEventsToIntervals(
      [ev('voice_leave', '2026-11-08T11:00:00Z', 'c1', null), ev('voice_join', '2026-11-08T10:00:00Z', null, 'c1')],
      AFK,
    );
    expect(intervals.map((i) => (i.endMs - i.startMs) / min)).toEqual([60]);
  });

  it('voice_present abre sessão e eventos sem pessoa ou servidor são ignorados', () => {
    const intervals = voiceEventsToIntervals(
      [
        ev('voice_present', '2026-11-08T10:00:00Z', null, 'c1'),
        ev('voice_leave', '2026-11-08T10:30:00Z', 'c1', null, { guildId: null }),
        ev('voice_leave', '2026-11-08T10:40:00Z', 'c1', null),
      ],
      AFK,
    );
    expect(intervals.map((i) => (i.endMs - i.startMs) / min)).toEqual([40]);
  });

  it('pessoas e servidores diferentes não se misturam', () => {
    const intervals = voiceEventsToIntervals(
      [
        ev('voice_join', '2026-11-08T10:00:00Z', null, 'c1'),
        ev('voice_join', '2026-11-08T10:10:00Z', null, 'c1', { discordUserId: 'u2' }),
        ev('voice_leave', '2026-11-08T10:20:00Z', 'c1', null, { discordUserId: 'u2' }),
        ev('voice_leave', '2026-11-08T10:30:00Z', 'c1', null, { guildId: 'g2' }),
        ev('voice_leave', '2026-11-08T11:00:00Z', 'c1', null),
      ],
      AFK,
    );
    expect(intervals.map((i) => (i.endMs - i.startMs) / min).toSorted()).toEqual([10, 60]);
  });

  it('timer aberto durante a call com pausa no AFK: AFK fora, sobreposição conta uma vez', () => {
    // Call 10:00-11:00 UTC com AFK 10:20-10:40; timer 10:30-11:30.
    const voice = voiceEventsToIntervals(
      [
        ev('voice_join', '2026-11-08T10:00:00Z', null, 'c1'),
        ev('voice_move', '2026-11-08T10:20:00Z', 'c1', 'afk'),
        ev('voice_move', '2026-11-08T10:40:00Z', 'afk', 'c1'),
        ev('voice_leave', '2026-11-08T11:00:00Z', 'c1', null),
      ],
      AFK,
    );
    const union = unionIntervals([...voice, { startMs: at('2026-11-08T10:30:00Z'), endMs: at('2026-11-08T11:30:00Z') }]);
    const total = union.reduce((s, i) => s + i.endMs - i.startMs, 0);
    // 10:00-10:20 (20) + 10:30-11:30 (60): o timer cobre parte do AFK, e isso conta.
    expect(total / min).toBe(80);
  });
});

describe('fatiamento por hora local: meia-noite e horário de verão', () => {
  it('preserva a duração total em vários fusos e intervalos longos', () => {
    const zones = [SP, NY, 'Europe/London', 'Asia/Kolkata', 'Australia/Lord_Howe', 'America/Santiago', 'Pacific/Chatham', 'UTC'];
    const starts = ['2026-03-07T20:13:00Z', '2026-04-04T22:00:00Z', '2026-09-05T23:59:00Z', '2026-10-31T23:45:00Z', '2026-11-01T04:30:00Z'];
    for (const tz of zones) {
      for (const s of starts) {
        const interval = { startMs: at(s), endMs: at(s) + 30 * hour + 7 * min };
        const slices = sliceByLocalHour(interval, tz);
        expect(sum(slices), `${tz} ${s}`).toBe(interval.endMs - interval.startMs);
        for (const slice of slices) {
          expect(slice.ms, `${tz} ${s}`).toBeGreaterThan(0);
          expect(slice.hour).toBeGreaterThanOrEqual(0);
          expect(slice.hour).toBeLessThan(24);
        }
      }
    }
  });

  it('volta do horário de verão (NY, 1 nov. 2026): a hora 1 repetida soma 2 h no mesmo dia', () => {
    // 00:30 EDT (04:30Z) até 03:30 EST (08:30Z): 4 h reais.
    const slices = sliceByLocalHour({ startMs: at('2026-11-01T04:30:00Z'), endMs: at('2026-11-01T08:30:00Z') }, NY);
    expect(sum(slices)).toBe(4 * hour);
    const byHour = new Map<number, number>();
    for (const s of slices) {
      expect(s.date).toBe('2026-11-01');
      byHour.set(s.hour, (byHour.get(s.hour) ?? 0) + s.ms);
    }
    expect(Object.fromEntries(byHour)).toEqual({ 0: 30 * min, 1: 2 * hour, 2: hour, 3: 30 * min });
  });

  it('início do horário de verão (NY, 8 mar. 2026): 01:30 a 03:30 local é 1 h real', () => {
    const start = fromLocal(NY, 2026, 3, 8, 1, 30);
    const end = fromLocal(NY, 2026, 3, 8, 3, 30);
    expect(end - start).toBe(hour);
    const slices = sliceByLocalHour({ startMs: start, endMs: end }, NY);
    expect(slices).toEqual([
      { date: '2026-03-08', weekday: 0, hour: 1, ms: 30 * min },
      { date: '2026-03-08', weekday: 0, hour: 3, ms: 30 * min },
    ]);
  });

  it('fuso em que a meia-noite não existe (Santiago, 6 set. 2026): o dia novo começa às 01:00', () => {
    // 5 set. 23:30 (-04) até 6 set. 01:30 (-03): 1 h real.
    const slices = sliceByLocalHour({ startMs: at('2026-09-06T03:30:00Z'), endMs: at('2026-09-06T04:30:00Z') }, 'America/Santiago');
    expect(slices).toEqual([
      { date: '2026-09-05', weekday: 6, hour: 23, ms: 30 * min },
      { date: '2026-09-06', weekday: 0, hour: 1, ms: 30 * min },
    ]);
  });

  it('virada de ano local cai no dia e na semana certos', () => {
    // 31 dez. 23:00 a 1 jan. 01:00 em São Paulo.
    const slices = sliceByLocalHour({ startMs: at('2027-01-01T02:00:00Z'), endMs: at('2027-01-01T04:00:00Z') }, SP);
    expect(slices.map((s) => [s.date, s.hour, s.ms / min])).toEqual([
      ['2026-12-31', 23, 60],
      ['2027-01-01', 0, 60],
    ]);
  });
});

describe('períodos e borda da semana', () => {
  it('domingo começa a própria semana e sábado ainda é da semana anterior', () => {
    const key = (r: ReturnType<typeof periodRange>) => [dateKey(r.start), dateKey(r.end)];
    expect(key(periodRange('semana', civil(2026, 11, 8)))).toEqual(['2026-11-08', '2026-11-15']);
    expect(key(periodRange('semana', civil(2026, 11, 14)))).toEqual(['2026-11-08', '2026-11-15']);
    // Semana que atravessa o ano.
    expect(key(periodRange('semana', civil(2027, 1, 1)))).toEqual(['2026-12-27', '2027-01-03']);
  });

  it('sábado 22:30 em São Paulo (domingo em UTC) conta no sábado da semana anterior', () => {
    // Hoje: domingo, 15 nov. 2026, 10:00 local.
    const data = buildDashboard('semana', {
      timeZone: SP,
      nowMs: at('2026-11-15T13:00:00Z'),
      intervals: [{ startMs: at('2026-11-15T01:30:00Z'), endMs: at('2026-11-15T02:30:00Z') }],
      recentSessions: [],
    });
    expect(data.period).toMatchObject({ startDate: '2026-11-15', endDate: '2026-11-21' });
    expect(data.totalMinutes).toBe(0);
    expect(data.previousTotalMinutes).toBe(60);
    expect(data.heatmap.flat().every((v) => v === 0)).toBe(true);
    // Ontem (sábado) contou, hoje ainda não: streak 1, sem quebrar.
    expect(data.streak).toMatchObject({ current: 1, todayMinutes: 0 });
  });

  it('sessão sábado 23:30 a domingo 00:30 divide-se entre as duas semanas', () => {
    const data = buildDashboard('semana', {
      timeZone: SP,
      nowMs: at('2026-11-15T13:00:00Z'),
      intervals: [{ startMs: at('2026-11-15T02:30:00Z'), endMs: at('2026-11-15T03:30:00Z') }],
      recentSessions: [],
    });
    expect(data.totalMinutes).toBe(30);
    expect(data.previousTotalMinutes).toBe(30);
    expect(data.heatmap[0]?.[0]).toBe(30);
    expect(data.heatmap[6]?.[23]).toBe(0);
  });

  it('o mesmo instante UTC muda de dia conforme o fuso da leitura', () => {
    const source = {
      nowMs: at('2026-11-09T15:00:00Z'),
      intervals: [{ startMs: at('2026-11-09T01:00:00Z'), endMs: at('2026-11-09T02:00:00Z') }],
      recentSessions: [],
    };
    const sp = buildDashboard('semana', { ...source, timeZone: SP });
    const tokyo = buildDashboard('semana', { ...source, timeZone: 'Asia/Tokyo' });
    // São Paulo: domingo 22h. Tóquio: segunda 10h.
    expect(sp.heatmap[0]?.[22]).toBe(60);
    expect(tokyo.heatmap[1]?.[10]).toBe(60);
  });
});

describe('streak: bordas', () => {
  it('histórico vazio dá zero', () => {
    expect(computeStreak(new Map(), civil(2026, 11, 9))).toEqual({ current: 0, best: 0 });
  });

  it('hoje e ontem sem tempo: zera a atual e mantém a melhor', () => {
    const minutes = new Map([
      ['2026-11-01', 20],
      ['2026-11-02', 20],
      ['2026-11-03', 20],
    ]);
    expect(computeStreak(minutes, civil(2026, 11, 9))).toEqual({ current: 0, best: 3 });
  });

  it('só hoje conta: streak 1', () => {
    expect(computeStreak(new Map([['2026-11-09', 15]]), civil(2026, 11, 9))).toEqual({ current: 1, best: 1 });
  });

  it('dias depois de hoje não entram em nenhuma das duas', () => {
    const minutes = new Map([
      ['2026-11-08', 20],
      ['2026-11-10', 20],
      ['2026-11-11', 20],
      ['2026-11-12', 20],
    ]);
    expect(computeStreak(minutes, civil(2026, 11, 9))).toEqual({ current: 1, best: 1 });
  });

  it('atravessa virada de mês e de ano', () => {
    const minutes = new Map([
      ['2026-12-30', 20],
      ['2026-12-31', 20],
      ['2027-01-01', 20],
    ]);
    expect(computeStreak(minutes, civil(2027, 1, 1))).toEqual({ current: 3, best: 3 });
  });

  it('dia com 14 min e 30 s não chega ao mínimo de 15 min', () => {
    const data = buildDashboard('semana', {
      timeZone: SP,
      nowMs: at('2026-11-09T15:00:00Z'),
      // Domingo 8 nov., 10:00 local, 14 min 30 s.
      intervals: [{ startMs: at('2026-11-08T13:00:00Z'), endMs: at('2026-11-08T13:14:30Z') }],
      recentSessions: [],
    });
    expect(data.countedDays).toBe(0);
    expect(data.streak.current).toBe(0);
  });

  it('sessão de 20 min que cruza a meia-noite (10 + 10) não faz nenhum dos dois dias contar', () => {
    const data = buildDashboard('semana', {
      timeZone: SP,
      nowMs: at('2026-11-09T15:00:00Z'),
      intervals: [{ startMs: at('2026-11-09T02:50:00Z'), endMs: at('2026-11-09T03:10:00Z') }],
      recentSessions: [],
    });
    expect(data.streak.current).toBe(0);
    expect(data.totalMinutes).toBe(20);
  });
});

describe('revalidação (F1-50, 2ª rodada)', () => {
  it('horário de verão de 30 min (Lord Howe, 4 out. 2026): 01:30 a 03:00 local é 1 h real', () => {
    const tz = 'Australia/Lord_Howe';
    // 02:00 local pula para 02:30.
    const start = fromLocal(tz, 2026, 10, 4, 1, 30);
    const slices = sliceByLocalHour({ startMs: start, endMs: start + hour }, tz);
    expect(slices).toEqual([
      { date: '2026-10-04', weekday: 0, hour: 1, ms: 30 * min },
      { date: '2026-10-04', weekday: 0, hour: 2, ms: 30 * min },
    ]);
  });

  it('volta do horário de verão em Santiago (5 abr. 2026, 00:00 vira 23:00): a hora 23 repetida fica no sábado', () => {
    // 4 abr. 22:30 (-03) até 5 abr. 00:30 (-04): 3 h reais.
    const slices = sliceByLocalHour({ startMs: at('2026-04-05T01:30:00Z'), endMs: at('2026-04-05T04:30:00Z') }, 'America/Santiago');
    expect(sum(slices)).toBe(3 * hour);
    expect(slices.map((s) => [s.date, s.hour, s.ms / min])).toEqual([
      ['2026-04-04', 22, 30],
      ['2026-04-04', 23, 60],
      ['2026-04-04', 23, 60],
      ['2026-04-05', 0, 30],
    ]);
  });

  it('intervalo que começa fora da hora cheia, com segundos e milissegundos', () => {
    const start = at('2026-11-08T13:59:59.500Z');
    const slices = sliceByLocalHour({ startMs: start, endMs: start + 1000 }, SP);
    expect(slices.map((s) => [s.hour, s.ms])).toEqual([
      [10, 500],
      [11, 500],
    ]);
  });

  it('hoje com 14 min 59 s não conta e não aparece como 15 min no cartão', () => {
    const data = buildDashboard('semana', {
      timeZone: SP,
      nowMs: at('2026-11-09T15:00:00Z'),
      intervals: [{ startMs: at('2026-11-09T11:00:00Z'), endMs: at('2026-11-09T11:14:59Z') }],
      recentSessions: [],
    });
    expect(data.streak).toMatchObject({ current: 0, todayMinutes: 14 });
    expect(data.countedDays).toBe(0);
  });

  it('exatamente 15 min conta', () => {
    const data = buildDashboard('semana', {
      timeZone: SP,
      nowMs: at('2026-11-09T15:00:00Z'),
      intervals: [{ startMs: at('2026-11-09T11:00:00Z'), endMs: at('2026-11-09T11:15:00Z') }],
      recentSessions: [],
    });
    expect(data.streak).toMatchObject({ current: 1, todayMinutes: 15 });
    expect(data.countedDays).toBe(1);
  });
});
