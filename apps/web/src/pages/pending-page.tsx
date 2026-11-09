import { CenteredMessage } from '@/pages/centered-message';

export function PendingPage() {
  return (
    <CenteredMessage title="Carregando…" role="status">
      <span className="sr-only">Aguarde enquanto a página carrega.</span>
    </CenteredMessage>
  );
}
