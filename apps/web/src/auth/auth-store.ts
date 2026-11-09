// Login SIMULADO (F1-16). O fluxo real com Discord, access token em memória e refresh por
// cookie entra na F1-17 (ADR 0003). O estado vive só em memória: recarregar a página
// desloga, e nada é gravado em localStorage ou sessionStorage.

export interface AuthUser {
  displayName: string;
}

export type AuthState = { status: 'anonymous' } | { status: 'authenticated'; user: AuthUser };

export interface AuthStore {
  getState: () => AuthState;
  subscribe: (listener: () => void) => () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SIMULATED_USER: AuthUser = { displayName: 'Estudante (simulado)' };

export function createSimulatedAuthStore(initial: AuthState = { status: 'anonymous' }): AuthStore {
  let state = initial;
  const listeners = new Set<() => void>();

  const setState = (next: AuthState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn: () => {
      setState({ status: 'authenticated', user: SIMULATED_USER });
      return Promise.resolve();
    },
    signOut: () => {
      setState({ status: 'anonymous' });
      return Promise.resolve();
    },
  };
}

// Controle (inclui tab, CR e LF, que o parser de URL descarta) e qualquer espaço Unicode.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\s]/u;

/**
 * Aceita só caminhos internos, para o `redirect` do login não virar redirecionamento aberto.
 * Resolve o valor como o navegador faria e recusa se sair da origem; devolve o caminho
 * normalizado (`pathname + search + hash`), nunca o texto recebido.
 */
export function sanitizeRedirect(value: unknown, origin: string = window.location.origin): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || UNSAFE_CHARS.test(value)) return undefined;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== new URL(origin).origin) return undefined;
  // A normalização de pontos pode fabricar `//host` (ex.: "/.//evil.example"), que seria
  // lido como outra origem numa segunda resolução.
  if (url.pathname.startsWith('//')) return undefined;

  const result = `${url.pathname}${url.search}${url.hash}`;
  // Exige idempotência: o resultado, resolvido de novo, precisa continuar igual e na origem.
  const again = new URL(result, origin);
  if (again.origin !== url.origin || `${again.pathname}${again.search}${again.hash}` !== result) return undefined;
  return result;
}
