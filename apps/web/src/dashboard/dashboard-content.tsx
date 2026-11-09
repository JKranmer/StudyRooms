import { lazy, Suspense, type ReactNode } from 'react';

import { formatDateRange, formatMinutes, formatSessionTime } from '@/dashboard/format';
import type { DashboardData, PeriodKind, RecentSession } from '@/dashboard/types';

// Gráficos sob demanda, fora do pacote inicial da rota.
const PeriodChart = lazy(() => import('@/dashboard/period-chart').then((m) => ({ default: m.PeriodChart })));
const StudyHeatmap = lazy(() => import('@/dashboard/study-heatmap').then((m) => ({ default: m.StudyHeatmap })));

const currentPeriodName: Record<PeriodKind, string> = {
  semana: 'nesta semana',
  mes: 'neste mês',
  trimestre: 'neste trimestre',
  semestre: 'neste semestre',
  ano: 'neste ano',
};
const previousPeriodName: Record<PeriodKind, string> = {
  semana: 'Semana anterior',
  mes: 'Mês anterior',
  trimestre: 'Trimestre anterior',
  semestre: 'Semestre anterior',
  ano: 'Ano anterior',
};
const chartTitle: Record<PeriodKind, string> = {
  semana: 'Tempo por dia (domingo a sábado)',
  mes: 'Tempo por dia do mês',
  trimestre: 'Tempo por semana (domingo a sábado)',
  semestre: 'Tempo por mês',
  ano: 'Tempo por mês',
};
const originLabel: Record<RecentSession['origin'], string> = {
  manual: 'Manual',
  timer: 'Timer do site',
  discord: 'Discord',
};

function days(count: number) {
  return count === 1 ? '1 dia' : `${String(count)} dias`;
}

function ChartFallback() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Carregando gráfico…
    </p>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border bg-card p-4 text-card-foreground">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

export function DashboardContent({ data }: { data: DashboardData }) {
  const { kind } = data.period;
  const { streak } = data;
  const todayCounts = streak.todayMinutes >= streak.thresholdMinutes;
  const isEmpty = data.totalMinutes === 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {formatDateRange(data.period.startDate, data.period.endDate)}. Horários no fuso {data.timeZone}.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title={`Total ${currentPeriodName[kind]}`}>
          <p className="text-2xl font-semibold">{formatMinutes(data.totalMinutes)}</p>
          <p className="text-sm text-muted-foreground">
            {previousPeriodName[kind]}: {formatMinutes(data.previousTotalMinutes)}
          </p>
        </Card>
        <Card title="Dias que contam">
          <p className="text-2xl font-semibold">{days(data.countedDays)}</p>
          <p className="text-sm text-muted-foreground">
            Com pelo menos {String(streak.thresholdMinutes)} min de estudo, {currentPeriodName[kind]}.
          </p>
        </Card>
        <Card title="Sequência">
          <p className="text-2xl font-semibold">{days(streak.current)}</p>
          <p className="text-sm text-muted-foreground">Melhor sequência: {days(streak.best)}</p>
          <p className="mt-1 text-sm">
            {todayCounts
              ? `Hoje já conta: ${formatMinutes(streak.todayMinutes)}.`
              : `Hoje: ${formatMinutes(streak.todayMinutes)} de ${String(streak.thresholdMinutes)} min. O dia só quebra a sequência quando termina.`}
          </p>
        </Card>
      </div>

      {isEmpty ? (
        <section aria-label="Gráficos" className="rounded-lg border p-6 text-center">
          <h2 className="font-medium">Nenhum estudo {currentPeriodName[kind]}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Registre um tempo manual, use o timer ou entre numa call com o bot para ver os gráficos.
          </p>
        </section>
      ) : (
        <>
          {/* Fronteiras separadas: o mapa de calor não espera o Recharts carregar. */}
          <section aria-label="Tempo no período" className="min-w-0 rounded-lg border p-4">
            <Suspense fallback={<ChartFallback />}>
              <PeriodChart title={chartTitle[kind]} buckets={data.buckets} />
            </Suspense>
          </section>
          <section aria-label="Mapa de calor" className="min-w-0 rounded-lg border p-4">
            <Suspense fallback={<ChartFallback />}>
              <StudyHeatmap minutes={data.heatmap} />
            </Suspense>
          </section>
        </>
      )}

      <section aria-labelledby="titulo-registros" className="rounded-lg border p-4">
        <h2 id="titulo-registros" className="font-medium">
          Registros recentes
        </h2>
        <p className="text-sm text-muted-foreground">
          Registros como foram feitos. Nos totais, o tempo sobreposto entre origens conta uma vez, e o canal AFK fica de
          fora.
        </p>
        {data.recentSessions.length === 0 ? (
          <p className="mt-3 text-sm">Nenhum registro ainda.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {data.recentSessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span>{formatSessionTime(session.startMs, session.endMs, data.timeZone)}</span>
                <span className="flex items-baseline gap-3">
                  <span className="rounded border px-1.5 py-0.5 text-xs">
                    {originLabel[session.origin]}
                    {session.guildName ? ` · ${session.guildName}` : ''}
                  </span>
                  <span className="tabular-nums">{formatMinutes((session.endMs - session.startMs) / 60_000)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
