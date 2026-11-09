// Theo (QA), F1-50: rota, URL, rede, aviso e isolamento do protótipo.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderApp, signedIn } from '@/test/render-app';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('protótipo do dashboard: rota e URL', () => {
  it.each(['SEMANA', 'Ano', '', 'toString', '__proto__', 'constructor', '1', 'semana ', 'mes%00'])(
    'período inválido %j cai na semana sem erro',
    async (value) => {
      renderApp(`/?periodo=${encodeURIComponent(value)}`, signedIn);
      expect(await screen.findByRole('region', { name: 'Total nesta semana' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it.each([
    ['mes', 'Total neste mês'],
    ['trimestre', 'Total neste trimestre'],
    ['semestre', 'Total neste semestre'],
    ['ano', 'Total neste ano'],
  ])('abre direto com ?periodo=%s', async (value, region) => {
    renderApp(`/?periodo=${value}`, signedIn);
    expect(await screen.findByRole('region', { name: region })).toBeInTheDocument();
  });

  it('período repetido na URL não quebra a tela e cai na semana', async () => {
    renderApp('/?periodo=ano&periodo=mes', signedIn);
    expect(await screen.findByRole('region', { name: 'Total nesta semana' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem login, vai para o login guardando o período, e volta para ele depois', async () => {
    const { router, user } = renderApp('/?periodo=ano');
    await screen.findByRole('button', { name: /entrar/i });
    expect(router.state.location.pathname).toBe('/login');
    expect(String(router.state.location.search.redirect)).toContain('periodo=ano');
    expect(screen.queryByRole('complementary', { name: 'Aviso de dados simulados' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByRole('region', { name: 'Total neste ano' })).toBeInTheDocument();
  });
});

describe('protótipo do dashboard: rede e aviso', () => {
  it('não faz nenhuma chamada de rede em nenhum período', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('rede proibida')));
    const xhrOpen = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        open = xhrOpen;
      },
    );
    const webSocket = vi.fn();
    vi.stubGlobal('WebSocket', webSocket);
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });

    const { user } = renderApp('/', signedIn);
    const nav = await screen.findByRole('navigation', { name: 'Período' });
    for (const name of ['Mês', 'Trimestre', 'Semestre', 'Ano', 'Semana']) {
      await user.click(within(nav).getByRole('link', { name }));
      await screen.findByRole('table', { name: /Minutos estudados no período/ });
      expect(screen.getByRole('complementary', { name: 'Aviso de dados simulados' })).toBeVisible();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(webSocket).not.toHaveBeenCalled();
  });

  it('o aviso aparece antes dos dados, já no estado de carregamento', async () => {
    renderApp('/', signedIn);
    const notice = await screen.findByRole('complementary', { name: 'Aviso de dados simulados' });
    expect(notice).toHaveTextContent('Dados simulados.');
    expect(notice).toHaveTextContent('não vêm da sua conta');
  });
});

describe('protótipo do dashboard: isolamento', () => {
  // Código-fonte de produção (sem testes), lido como texto pelo Vite.
  const sources = Object.entries(
    import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/test/**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, code]) => ({ path: path.replace(/^\/src\//, ''), code }));

  it('lê os arquivos de produção', () => {
    expect(sources.map((s) => s.path)).toContain('pages/dashboard-page.tsx');
    expect(sources.map((s) => s.path)).toContain('prototype/calculations.ts');
  });

  it('fora de src/prototype, só a página do dashboard importa o protótipo', () => {
    const importers = sources
      .filter(({ path, code }) => !path.startsWith('prototype/') && /from ['"]@\/prototype\//.test(code))
      .map(({ path }) => path);
    expect(importers).toEqual(['pages/dashboard-page.tsx']);
  });

  it('o protótipo só depende do modelo de visualização, não de outras telas', () => {
    const imports = sources
      .filter(({ path }) => path.startsWith('prototype/'))
      .flatMap(({ code }) => [...code.matchAll(/from ['"](@\/[^'"]+)['"]/g)].map((m) => m[1] ?? ''));
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec).toMatch(/^@\/(prototype|dashboard\/types)/);
  });
});
