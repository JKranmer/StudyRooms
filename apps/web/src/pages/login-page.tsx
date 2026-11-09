import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { sanitizeRedirect } from '@/auth/auth-store';
import { useAuth } from '@/auth/use-auth';
import { Button } from '@/components/ui/button';

export function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setSubmitting(true);
    try {
      await signIn();
      await router.invalidate();
      await navigate({ href: sanitizeRedirect(search.redirect) ?? '/', replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="conteudo" className="flex min-h-svh items-center justify-center p-6">
      <section aria-labelledby="titulo-login" className="w-full max-w-sm rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <h1 id="titulo-login" className="text-2xl font-semibold">
          Entrar no StudyRooms
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Acompanhe suas horas de estudo nas salas do Discord.
        </p>
        <Button className="mt-6 w-full" onClick={() => void handleSignIn()} disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar com Discord'}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          Login simulado nesta versão: nenhuma conta do Discord é usada.
        </p>
      </section>
    </main>
  );
}
