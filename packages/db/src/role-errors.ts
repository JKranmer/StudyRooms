import { findErrorCode } from "./errors.ts";

const MAX_MESSAGE = 300;

/**
 * Mensagem do servidor pronta para mostrar ao usuário, sem segredos. Tira os segredos conhecidos
 * (senhas e verificadores enviados), URLs de conexão, hosts, literais entre aspas simples e
 * qualquer sequência longa que pareça senha, hash ou base64. Sem mensagem, devolve undefined.
 */
export function safeServerMessage(error: unknown, secrets: readonly string[] = []): string | undefined {
  const raw = (error as { message?: unknown } | null)?.message;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  let text = raw;
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join("[omitido]");
  }
  text = text
    // Controle (inclusive ANSI e U+0085), formatação invisível (bidi, largura zero) e separadores
    // de linha e parágrafo Unicode: nada disso chega ao terminal.
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/postgres(ql)?:\/\/\S*/gi, "[url omitida]")
    // usuário:senha@ sem esquema (senhas do Neon, `npg_` + 12, nem sempre têm dígito).
    .replace(/\S+:\S+@/g, "[omitido]@")
    .replace(/'[^']*'?/g, "'[omitido]'")
    // Identificador entre aspas duplas só passa se for um nome simples (como "studyrooms_bot").
    .replace(/"([^"]*)"?/g, (match, inner: string) => (/^[a-z_][a-z0-9_$]{0,62}$/i.test(inner) ? match : '"[omitido]"'))
    .replace(/\b[\w-]+(\.[\w-]+){2,}\b/g, "[host omitido]")
    // Sequência longa com dígito e letra, ou com caracteres de base64 e de SCRAM: senha, hash, salt.
    .replace(/[A-Za-z0-9+/=_$:-]{16,}/g, (token) =>
      (/[0-9]/.test(token) && /[A-Za-z]/.test(token)) || /[+/=$]/.test(token) ? "[omitido]" : token,
    )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}...` : text;
}

/**
 * Falha do `setupRoles`, com a etapa em que aconteceu. Nunca leva a URL, a senha nem o verificador:
 * `serverMessage` já sai filtrada por `safeServerMessage`, e o erro original não é guardado.
 */
export class RoleSetupError extends Error {
  readonly stage: string;
  readonly code: string | undefined;
  readonly serverMessage: string | undefined;

  constructor(stage: string, error: unknown, secrets: readonly string[] = []) {
    const code = findErrorCode(error);
    const serverMessage = safeServerMessage(error, secrets);
    super(`falhou ao ${stage} (código ${code ?? "desconhecido"})${serverMessage ? `: ${serverMessage}` : ""}`);
    this.name = "RoleSetupError";
    this.stage = stage;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}
