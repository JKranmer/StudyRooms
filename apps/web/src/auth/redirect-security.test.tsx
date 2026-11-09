// Testes de QA (Theo) contra redirecionamento aberto no `redirect` do login.
// O parser de URL do navegador (WHATWG) remove tab, LF e CR em qualquer posição, então
// "/\t/evil.example" vira "//evil.example", que é de outra origem.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { sanitizeRedirect } from '@/auth/auth-store';
import { renderApp, signedIn } from '@/test/render-app';

const ORIGIN = 'http://localhost:3000';

const escapesOrigin = ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\t\\evil.example'];

describe('sanitizeRedirect contra caracteres que o parser de URL descarta', () => {
  it.each(escapesOrigin)('%j não pode resultar em outra origem', (input) => {
    const out = sanitizeRedirect(input);
    if (out !== undefined) expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
  });
});

// A normalização de pontos pode produzir "//host": "/.//evil.example" resolve para pathname "//evil.example".
const normalizesToProtocolRelative = ['/.//evil.example', '/..//evil.example', '/a/..//evil.example', '/%2e//evil.example'];

describe('sanitizeRedirect não devolve caminho que, reaplicado, aponta para outra origem', () => {
  it.each(normalizesToProtocolRelative)('%j', (input) => {
    const out = sanitizeRedirect(input, ORIGIN);
    if (out !== undefined) {
      expect(out.startsWith('//')).toBe(false);
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
    }
  });

  it.each([...escapesOrigin, ...normalizesToProtocolRelative, '/salas?periodo=semana#x'])('é idempotente para %j', (input) => {
    const once = sanitizeRedirect(input, ORIGIN);
    expect(sanitizeRedirect(once, ORIGIN)).toBe(once);
  });
});

describe('quem já está logado e abre o login com redirect malicioso', () => {
  it.each([...escapesOrigin, '/　/evil.example'])('%j cai no início, sem página de erro', async (input) => {
    const { router } = renderApp('/login?redirect=' + encodeURIComponent(input), signedIn);

    expect(await screen.findByRole('heading', { name: 'Seu estudo' })).toBeInTheDocument();
    expect(router.state.location.href).toBe('/');
  });
});
