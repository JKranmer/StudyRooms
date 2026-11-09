import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderApp, signedIn } from '@/test/render-app';

vi.mock('@/prototype/use-simulated-dashboard', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    useSimulatedDashboard: () =>
      useQuery({ queryKey: ['falha'], queryFn: () => Promise.reject(new Error('falha')), retry: false }),
  };
});

describe('dashboard: erro ao carregar', () => {
  it('mostra o erro e permite tentar de novo, mantendo o aviso de dado simulado', async () => {
    renderApp('/', signedIn);

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os dados.');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Aviso de dados simulados' })).toBeInTheDocument();
  });
});
