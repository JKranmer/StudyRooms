export type ShutdownDeps = {
  /** Para os handlers (nada mais é logado depois disso). */
  stop(): void;
  /** Fecha o cliente do Discord. Com login ou reconexão pendentes, pode demorar ou nunca resolver. */
  destroy(): Promise<unknown>;
  exit(code: number): void;
  /** Prazo para o cliente fechar antes de sair mesmo assim. Deve caber no prazo do `docker stop`. */
  graceMs: number;
  setTimer(fn: () => void, ms: number): void;
};

export type Shutdown = ((exitCode?: number) => void) & { readonly started: boolean };

/**
 * Encerramento para SIGINT, SIGTERM e erro fatal. Sai quando o cliente fecha ou quando vence o
 * prazo, o que vier primeiro; um segundo pedido sai na hora. O código de saída é o do primeiro pedido.
 */
export function createShutdown(deps: ShutdownDeps): Shutdown {
  let code: number | null = null;
  let exited = false;

  const exit = () => {
    if (exited || code === null) return;
    exited = true;
    deps.exit(code);
  };

  const shutdown = (exitCode = 0) => {
    if (code !== null) return exit();
    code = exitCode;
    deps.stop();
    deps.setTimer(exit, deps.graceMs);
    try {
      deps.destroy().then(exit, exit);
    } catch {
      exit();
    }
  };

  return Object.defineProperty(shutdown, "started", { get: () => code !== null }) as Shutdown;
}
