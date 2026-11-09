import { createContext, use, useSyncExternalStore } from 'react';

import type { AuthStore } from '@/auth/auth-store';

export const AuthContext = createContext<AuthStore | null>(null);

export function useAuth() {
  const store = use(AuthContext);
  if (!store) throw new Error('useAuth precisa estar dentro de <AuthContext>.');
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { state, signIn: store.signIn, signOut: store.signOut };
}
