import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp, signedIn } from '@/test/render-app';

describe('dashboard (protótipo com dados simulados)', () => {
  it('avisa de forma visível que os dados são simulados', async () => {
    renderApp('/', signedIn);

    const notice = await screen.findByRole('complementary', { name: 'Aviso de dados simulados' });
    expect(notice).toHaveTextContent('Dados simulados.');
  });

  it('mostra total da semana, streak e mapa de calor com valores em texto', async () => {
    renderApp('/', signedIn);

    expect(await screen.findByRole('region', { name: 'Total nesta semana' })).toBeInTheDocument();
    const streak = screen.getByRole('region', { name: 'Sequência' });
    expect(streak).toHaveTextContent('Hoje: 10 min de 15 min');

    const table = await screen.findByRole('table', { name: /Minutos estudados no período/ }, { timeout: 5000 });
    // 7 dias da semana, cada um com 24 horas e o valor escrito.
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(7);
    expect(within(rows[0] as HTMLElement).getAllByRole('cell')).toHaveLength(24);
    expect(within(table).getByRole('rowheader', { name: 'Domingo' })).toBeInTheDocument();
  });

  it('troca o período pela navegação e guarda a escolha na URL', async () => {
    const { router, user } = renderApp('/', signedIn);

    const nav = await screen.findByRole('navigation', { name: 'Período' });
    expect(within(nav).getByRole('link', { name: 'Semana' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(nav).getByRole('link', { name: 'Ano' }));

    expect(await screen.findByRole('region', { name: 'Total neste ano' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ periodo: 'ano' });
    expect(within(nav).getByRole('link', { name: 'Ano' })).toHaveAttribute('aria-current', 'page');
    // O gráfico (Recharts) carrega sob demanda; a tabela alternativa repete os valores.
    expect(await screen.findByRole('table', { name: 'Tempo por mês' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'novembro de 2026' })).toBeInTheDocument();
  });

  it('ignora período inválido na URL e usa a semana', async () => {
    renderApp('/?periodo=decada', signedIn);

    expect(await screen.findByRole('region', { name: 'Total nesta semana' })).toBeInTheDocument();
  });

  it('mostra a origem de cada registro, com o servidor nos registros do bot', async () => {
    renderApp('/', signedIn);

    const list = await screen.findByRole('region', { name: 'Registros recentes' });
    expect(within(list).getByText('Manual')).toBeInTheDocument();
    expect(within(list).getAllByText(/Discord · .+\(simulado\)/).length).toBeGreaterThan(0);
  });
});
