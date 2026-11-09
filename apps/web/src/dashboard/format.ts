// Formatação para exibição. Horários chegam em UTC e só aqui recebem o fuso do usuário.

export function formatMinutes(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest).padStart(2, '0')} min`;
}

/** Datas locais `AAAA-MM-DD`, já no calendário do usuário. */
function civilToUtcMs(key: string) {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

const dateRangeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatDateRange(startDate: string, endDate: string) {
  return dateRangeFormat.formatRange(civilToUtcMs(startDate), civilToUtcMs(endDate));
}

export function formatSessionTime(startMs: number, endMs: number, timeZone: string) {
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
  const sameDay = day.format(startMs) === day.format(endMs);
  return sameDay
    ? `${day.format(startMs)}, ${time.format(startMs)} às ${time.format(endMs)}`
    : `${day.format(startMs)}, ${time.format(startMs)} a ${day.format(endMs)}, ${time.format(endMs)}`;
}

export const weekdayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
export const weekdayShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
