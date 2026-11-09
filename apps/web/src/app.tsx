import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import type { AuthStore } from '@/auth/auth-store';
import { AuthContext } from '@/auth/use-auth';
import type { createAppRouter } from '@/router';

interface AppProps {
  auth: AuthStore;
  queryClient: QueryClient;
  router: ReturnType<typeof createAppRouter>;
}

export function App({ auth, queryClient, router }: AppProps) {
  return (
    <AuthContext value={auth}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthContext>
  );
}
