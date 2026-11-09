import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatMinutes } from '@/dashboard/format';
import type { PeriodBucket } from '@/dashboard/types';

const CHART_HEIGHT = 220;
// emerald-700: contraste suficiente sobre o fundo branco.
const BAR_COLOR = '#047857';

interface PeriodChartProps {
  title: string;
  buckets: PeriodBucket[];
}

function formatAxisHours(minutes: number) {
  return minutes === 0 ? '0' : `${String(minutes / 60)} h`;
}

/** Marcas do eixo em horas cheias (1, 2, 5, 10… h), no máximo 5 intervalos. */
export function hourTicks(maxMinutes: number) {
  const maxHours = Math.max(1, Math.ceil(maxMinutes / 60));
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => maxHours / s <= 5) ?? 1000;
  const top = Math.ceil(maxHours / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step * 60);
}

/**
 * Barras do período com Recharts. O gráfico tem a camada de acessibilidade do Recharts
 * (setas mostram o valor de cada barra), e os mesmos valores ficam numa tabela logo abaixo.
 */
export function PeriodChart({ title, buckets }: PeriodChartProps) {
  const data = buckets.map((bucket) => ({
    label: bucket.label,
    longLabel: bucket.longLabel,
    // Dia que ainda não chegou fica sem barra, em vez de zero.
    minutes: bucket.isFuture ? null : bucket.minutes,
  }));

  const ticks = hourTicks(Math.max(0, ...buckets.map((bucket) => bucket.minutes)));

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="font-medium">{title}</figcaption>
      <div className="min-w-0" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: CHART_HEIGHT }}>
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={4} />
            <YAxis tickFormatter={formatAxisHours} fontSize={11} width={44} ticks={ticks} domain={[0, ticks.at(-1) ?? 60]} />
            <Tooltip
              cursor={{ fillOpacity: 0.15 }}
              labelFormatter={(_, payload) => {
                const item = payload[0]?.payload as { longLabel?: string } | undefined;
                return item?.longLabel ?? '';
              }}
              formatter={(value) => [typeof value === 'number' ? formatMinutes(value) : 'ainda não chegou', 'Tempo']}
            />
            <Bar dataKey="minutes" name="Tempo" fill={BAR_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Ver os valores em tabela</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="font-medium">
                Intervalo
              </th>
              <th scope="col" className="text-right font-medium">
                Tempo
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-t">
                <th scope="row" className="py-1 font-normal">
                  {bucket.longLabel}
                </th>
                <td className="py-1 text-right tabular-nums">
                  {bucket.isFuture ? 'ainda não chegou' : formatMinutes(bucket.minutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
