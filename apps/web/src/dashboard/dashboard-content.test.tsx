import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardContent } from '@/dashboard/dashboard-content';
import type { DashboardData } from '@/dashboard/types';

const empty: DashboardData = {
  timeZone: 'America/Sao_Paulo',
  period: { kind: 'mes', startDate: '2026-11-01', endDate: '2026-11-30' },
  totalMinutes: 0,
  previousTotalMinutes: 0,
  countedDays: 0,
  buckets: [],
  heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  streak: { current: 0, best: 0, todayMinutes: 0, thresholdMinutes: 15 },
  recentSessions: [],
};

describe('DashboardContent', () => {
  it('mostra estado vazio quando o período não tem estudo', () => {
    render(<DashboardContent data={empty} />);

    expect(screen.getByRole('heading', { name: 'Nenhum estudo neste mês' })).toBeInTheDocument();
    expect(screen.getByText('Nenhum registro ainda.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exibe os horários no fuso do usuário', () => {
    render(
      <DashboardContent
        data={{
          ...empty,
          recentSessions: [
            // 01:00 a 02:30 UTC = 22:00 a 23:30 em São Paulo, no dia anterior.
            { id: 'a', origin: 'timer', startMs: Date.parse('2026-11-09T01:00:00Z'), endMs: Date.parse('2026-11-09T02:30:00Z') },
          ],
        }}
      />,
    );

    expect(screen.getByText(/22:00 às 23:30/)).toHaveTextContent(/8 de nov/);
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument();
  });
});
