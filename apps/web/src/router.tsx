import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';

import { sanitizeRedirect, type AuthStore } from '@/auth/auth-store';
import { RootLayout } from '@/pages/root-layout';
import { NotFoundPage } from '@/pages/not-found-page';
import { RouteErrorPage } from '@/pages/route-error-page';
import { PendingPage } from '@/pages/pending-page';

export interface RouterContext {
  auth: AuthStore;
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // O valor validado sobrescreve o bruto: a busca da raiz repassa os parâmetros originais.
  validateSearch: (search: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.auth.getState().status === 'authenticated') {
      throw redirect({ href: sanitizeRedirect(search.redirect) ?? '/' });
    }
  },
  component: lazyRouteComponent(() => import('@/pages/login-page'), 'LoginPage'),
});

// Rota de layout sem caminho: tudo abaixo dela exige login.
const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  beforeLoad: ({ context, location }) => {
    if (context.auth.getState().status !== 'authenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: lazyRouteComponent(() => import('@/pages/app-layout'), 'AppLayout'),
});

const dashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/pages/dashboard-page'), 'DashboardPage'),
});

const routeTree = rootRoute.addChildren([loginRoute, authenticatedRoute.addChildren([dashboardRoute])]);

export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    ...(history ? { history } : {}),
    defaultPreload: 'intent',
    defaultErrorComponent: RouteErrorPage,
    defaultPendingComponent: PendingPage,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
