import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app';
import { createSimulatedAuthStore, type AuthState } from '@/auth/auth-store';
import { createQueryClient } from '@/query-client';
import { createAppRouter } from '@/router';

export function renderApp(path: string, initialAuth?: AuthState) {
  const auth = createSimulatedAuthStore(initialAuth);
  const queryClient = createQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ auth, queryClient }, history);
  const user = userEvent.setup();
  const view = render(<App auth={auth} queryClient={queryClient} router={router} />);
  return { ...view, auth, router, user };
}

export const signedIn: AuthState = { status: 'authenticated', user: { displayName: 'Ana' } };
