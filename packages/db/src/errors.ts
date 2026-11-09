/**
 * Devolve o código de um erro do banco: SQLSTATE (como 23514) ou código de rede (como
 * ECONNREFUSED). O Drizzle embrulha o erro do driver em `cause`, por isso a busca desce na cadeia.
 *
 * Use o código, nunca `error.message`, em log: a mensagem do Drizzle e do pg traz o SQL e os
 * valores dos parâmetros, inclusive IDs do Discord e detalhes da conexão.
 */
export function findErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && /^[A-Z0-9_]{2,32}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}

/**
 * Classes 22 (dado inválido) e 23 (restrição violada): o banco recusou o conteúdo da linha.
 * Reenviar a mesma linha falharia sempre; qualquer outro código (conexão, banco desligado,
 * permissão) é falha de ambiente, e reenviar depois pode dar certo.
 */
export function isRejectedRowCode(code: string | undefined): boolean {
  return code !== undefined && /^2[23][0-9A-Z]{3}$/.test(code);
}
