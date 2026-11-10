export type UrlCheck = { errors: string[]; warnings: string[] };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

/**
 * Confere uma URL de conexão do Neon sem nunca repetir o valor (ele tem a senha). Exige SSL:
 * `sslmode=verify-full` ou `require`. No driver do projeto (pg 8), os dois verificam o certificado,
 * mas `require` gera um aviso de segurança no log (uma vez por processo).
 */
export function checkNeonUrl(name: string, value: string | undefined): UrlCheck {
  const result: UrlCheck = { errors: [], warnings: [] };
  const raw = value?.trim();
  if (!raw) {
    result.errors.push(`${name} não definida. Veja docs/runbooks/neon.md.`);
    return result;
  }
  if (!/^postgres(ql)?:\/\//.test(raw)) {
    result.errors.push(`${name} inválida: deve começar com postgres:// ou postgresql://.`);
    return result;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    result.errors.push(`${name} inválida: não é uma URL.`);
    return result;
  }
  if (LOCAL_HOSTS.has(url.hostname)) {
    result.errors.push(`${name} aponta para a máquina local; use a conexão do Neon.`);
    return result;
  }
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode !== "require" && sslmode !== "verify-full") {
    result.errors.push(`${name} sem SSL obrigatório: use ?sslmode=verify-full (ou require) no fim da URL (veja docs/runbooks/neon.md).`);
  }
  if (name === "NEON_ADMIN_URL" && url.hostname.split(".")[0]?.endsWith("-pooler")) {
    result.warnings.push(`${name} usa o pooler (-pooler no host); para migrations e papéis, prefira a conexão direta.`);
  }
  return result;
}
