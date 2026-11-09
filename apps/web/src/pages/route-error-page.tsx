import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { CenteredMessage } from '@/pages/centered-message';

export function RouteErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  useEffect(() => {
    queryErrorResetBoundary.reset();
  }, [queryErrorResetBoundary]);

  if (import.meta.env.DEV) console.error(error);

  return (
    <CenteredMessage title="Algo deu errado" role="alert">
      <p className="text-muted-foreground">Não foi possível carregar esta página. Tente de novo em instantes.</p>
      <Button onClick={() => void router.invalidate()}>Tentar de novo</Button>
    </CenteredMessage>
  );
}
