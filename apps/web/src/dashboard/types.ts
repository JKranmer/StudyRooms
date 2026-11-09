// Modelo de visualização do dashboard. Não é contrato da API: os dados reais entram em
// F1-35 e F1-36, pelos schemas Zod de packages/shared (F1-09). Até lá, quem preenche este
// modelo é o protótipo em `src/prototype`.

export const periodKinds = ['semana', 'mes', 'trimestre', 'semestre', 'ano'] as const;
export type PeriodKind = (typeof periodKinds)[number];

export const periodLabels: Record<PeriodKind, string> = {
  semana: 'Semana',
  mes: 'Mês',
  trimestre: 'Trimestre',
  semestre: 'Semestre',
  ano: 'Ano',
};

export function parsePeriodKind(value: unknown): PeriodKind | undefined {
  return periodKinds.find((kind) => kind === value);
}

export type SessionOrigin = 'manual' | 'timer' | 'discord';

export interface PeriodBucket {
  key: string;
  /** Rótulo curto, para o eixo. */
  label: string;
  /** Rótulo completo, para leitores de tela e dica. */
  longLabel: string;
  minutes: number;
  /** O intervalo ainda não começou (ex.: dias depois de hoje na semana atual). */
  isFuture: boolean;
}

export interface RecentSession {
  id: string;
  origin: SessionOrigin;
  /** Instantes em UTC (ms desde a época); o fuso só entra na exibição. */
  startMs: number;
  endMs: number;
  /** Servidor de origem, visível em todo registro do bot. */
  guildName?: string;
}

export interface DashboardData {
  /** Fuso IANA do perfil, aplicado só na leitura. */
  timeZone: string;
  period: {
    kind: PeriodKind;
    /** Datas locais `AAAA-MM-DD`, com o fim inclusivo. */
    startDate: string;
    endDate: string;
  };
  totalMinutes: number;
  previousTotalMinutes: number;
  /** Dias do período que contam para a streak. */
  countedDays: number;
  buckets: PeriodBucket[];
  /** Minutos por dia da semana (0 = domingo) e hora local (0 a 23). */
  heatmap: number[][];
  streak: {
    current: number;
    best: number;
    todayMinutes: number;
    thresholdMinutes: number;
  };
  recentSessions: RecentSession[];
}
