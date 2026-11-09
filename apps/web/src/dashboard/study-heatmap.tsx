import { formatMinutes, weekdayNames, weekdayShort } from '@/dashboard/format';
import { cn } from '@/lib/utils';

interface StudyHeatmapProps {
  /** Minutos por dia da semana (0 = domingo) e hora local. */
  minutes: number[][];
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

// O nível aparece pelo tamanho do quadrado, além da cor, e o valor está em texto em cada célula.
const levelClass = ['size-0', 'size-1.5 bg-emerald-300', 'size-2.5 bg-emerald-500', 'size-3.5 bg-emerald-700', 'size-4 bg-emerald-900'];
const levelNames = ['Nada', 'Pouco', 'Médio', 'Bastante', 'Muito'];

function levelOf(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

function hourLabel(hour: number) {
  return `${String(hour)}h às ${String((hour + 1) % 24)}h`;
}

function summarize(minutes: number[][]) {
  const byHour = HOURS.map((hour) => minutes.reduce((sum, row) => sum + (row[hour] ?? 0), 0));
  const byDay = minutes.map((row) => row.reduce((sum, value) => sum + value, 0));
  const studied = byHour.map((value, hour) => ({ value, hour })).filter(({ value }) => value > 0);
  if (studied.length === 0) return undefined;
  const most = studied.reduce((a, b) => (b.value > a.value ? b : a));
  const least = studied.reduce((a, b) => (b.value < a.value ? b : a));
  const bestDay = byDay.reduce((best, value, day) => (value > (byDay[best] ?? 0) ? day : best), 0);
  return { most, least, bestDay };
}

export function StudyHeatmap({ minutes }: StudyHeatmapProps) {
  const max = Math.max(0, ...minutes.flat());
  const summary = summarize(minutes);

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="font-medium">Quando você estuda: dia da semana × hora</figcaption>
      {summary ? (
        <ul className="text-sm text-muted-foreground">
          <li>
            Hora com mais estudo: <strong className="text-foreground">{hourLabel(summary.most.hour)}</strong> (
            {formatMinutes(summary.most.value)})
          </li>
          <li>
            Hora com menos estudo, entre as que têm algum tempo:{' '}
            <strong className="text-foreground">{hourLabel(summary.least.hour)}</strong> ({formatMinutes(summary.least.value)})
          </li>
          <li>
            Dia da semana com mais estudo: <strong className="text-foreground">{weekdayNames[summary.bestDay]}</strong>
          </li>
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Sem estudo registrado neste período.</p>
      )}
      {/* `relative`: os textos sr-only das células (absolutos) ficam contidos na rolagem. */}
      <div className="relative overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[11px]">
          <caption className="sr-only">
            Minutos estudados no período por dia da semana (linhas) e hora local (colunas)
          </caption>
          <thead>
            <tr>
              <td />
              {HOURS.map((hour) => (
                <th key={hour} scope="col" className="w-5 font-normal text-muted-foreground">
                  <span aria-hidden="true">{hour % 3 === 0 ? hour : ''}</span>
                  <span className="sr-only">{hourLabel(hour)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {minutes.map((row, day) => (
              <tr key={day}>
                <th scope="row" className="pr-2 text-left font-normal text-muted-foreground">
                  <span aria-hidden="true">{weekdayShort[day]}</span>
                  <span className="sr-only">{weekdayNames[day]}</span>
                </th>
                {row.map((value, hour) => {
                  const level = levelOf(value, max);
                  return (
                    <td
                      key={hour}
                      title={`${weekdayNames[day] ?? ''}, ${hourLabel(hour)}: ${formatMinutes(value)}`}
                      className="size-5 rounded-sm bg-muted p-0 align-middle"
                    >
                      <span className="flex size-5 items-center justify-center">
                        <span aria-hidden="true" className={cn('rounded-[2px]', levelClass[level])} />
                      </span>
                      <span className="sr-only">{formatMinutes(value)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Legenda (tamanho e cor):</span>
        {levelNames.map((name, level) => (
          <span key={name} className="flex items-center gap-1">
            <span className="flex size-5 items-center justify-center rounded-sm bg-muted">
              <span aria-hidden="true" className={cn('rounded-[2px]', levelClass[level])} />
            </span>
            {name}
          </span>
        ))}
        <span>Máximo por célula: {formatMinutes(max)}</span>
      </div>
    </figure>
  );
}
