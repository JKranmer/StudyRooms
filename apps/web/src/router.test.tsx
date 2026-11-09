import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp, signedIn } from '@/test/render-app';

describe('rotas', () => {
  it('redireciona a rota protegida para o login, guardando o destino', async () => {
    const { router } = renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Entrar no StudyRooms' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/' });
  });

  it('volta ao destino original depois do login simulado', async () => {
    const { router, user } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Entrar com Discord' }));

    expect(await screen.findByRole('heading', { name: 'Seu estudo' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('ignora redirect para fora do site', async () => {
    const { router, user } = renderApp('/login?redirect=%2F%2Fevil.example');

    await user.click(await screen.findByRole('button', { name: 'Entrar com Discord' }));

    expect(await screen.findByRole('heading', { name: 'Seu estudo' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('preserva a query string do destino original', async () => {
    const { router, user } = renderApp('/?periodo=semana');

    await user.click(await screen.findByRole('button', { name: 'Entrar com Discord' }));

    expect(await screen.findByRole('heading', { name: 'Seu estudo' })).toBeInTheDocument();
    expect(router.state.location.href).toBe('/?periodo=semana');
  });

  it('quem já está logado não segue redirect para fora do site', async () => {
    const { router } = renderApp('/login?redirect=%2F%2Fevil.example', signedIn);

    expect(await screen.findByRole('heading', { name: 'Seu estudo' })).toBeInTheDocument();
    expect(router.state.location.href).toBe('/');
  });

  it('mostra o dashboard a quem já está logado e tira do login', async () => {
    const { router } = renderApp('/login', signedIn);

    expect(await screen.findByRole('heading', { name: 'Seu estudo' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('sair encerra a sessão e leva ao login', async () => {
    const { auth, router, user } = renderApp('/', signedIn);

    await user.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('heading', { name: 'Entrar no StudyRooms' })).toBeInTheDocument();
    expect(auth.getState().status).toBe('anonymous');
    expect(router.state.location.pathname).toBe('/login');
  });

  it('mostra página de erro em rota inexistente', async () => {
    renderApp('/nao-existe');

    expect(await screen.findByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  });

  it('não grava nada em localStorage nem sessionStorage', async () => {
    const { user } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Entrar com Discord' }));
    await screen.findByRole('heading', { name: 'Seu estudo' });

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
