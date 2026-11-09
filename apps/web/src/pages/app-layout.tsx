import { Link, Outlet, useNavigate } from '@tanstack/react-router';

import { useAuth } from '@/auth/use-auth';
import { Button } from '@/components/ui/button';

export function AppLayout() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    await navigate({ to: '/login', replace: true });
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/" className="font-semibold">
            StudyRooms
          </Link>
          <nav aria-label="Conta" className="flex items-center gap-3">
            {state.status === 'authenticated' && (
              <span className="text-sm text-muted-foreground">{state.user.displayName}</span>
            )}
            <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
              Sair
            </Button>
          </nav>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
