import { describe, expect, it, vi } from 'vitest';

import { createSimulatedAuthStore, sanitizeRedirect } from '@/auth/auth-store';

describe('createSimulatedAuthStore', () => {
  it('começa anônimo, entra, sai e avisa os inscritos', async () => {
    const store = createSimulatedAuthStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getState().status).toBe('anonymous');
    await store.signIn();
    expect(store.getState().status).toBe('authenticated');
    await store.signOut();
    expect(store.getState().status).toBe('anonymous');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await store.signIn();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('sanitizeRedirect', () => {
  it.each([
    ['/', '/'],
    ['/salas?periodo=semana', '/salas?periodo=semana'],
    ['//evil.example', undefined],
    ['/\\evil.example', undefined],
    ['https://evil.example', undefined],
    ['/\t/evil.example', undefined],
    ['/　/evil.example', undefined],
    ['/salas/../perfil#topo', '/perfil#topo'],
    [42, undefined],
    [undefined, undefined],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeRedirect(input)).toBe(expected);
  });
});
