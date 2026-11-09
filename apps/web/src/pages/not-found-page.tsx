import { Link } from '@tanstack/react-router';

import { buttonVariants } from '@/components/ui/button';
import { CenteredMessage } from '@/pages/centered-message';

export function NotFoundPage() {
  return (
    <CenteredMessage title="Página não encontrada">
      <p className="text-muted-foreground">O endereço acessado não existe ou foi movido.</p>
      <Link to="/" className={buttonVariants()}>
        Voltar ao início
      </Link>
    </CenteredMessage>
  );
}
