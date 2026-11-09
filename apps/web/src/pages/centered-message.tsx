import type { ReactNode } from 'react';

interface CenteredMessageProps {
  title: string;
  children?: ReactNode;
  role?: 'alert' | 'status';
}

/** Página simples e centralizada, usada por erro, 404 e carregamento. */
export function CenteredMessage({ title, children, role }: CenteredMessageProps) {
  return (
    <main id="conteudo" className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div role={role} className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
