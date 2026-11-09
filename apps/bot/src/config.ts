export type BotConfig =
  | { ok: true; token: string; allowlist: Set<string>; warnings: string[] }
  | { ok: false; error: string };

type Env = Record<string, string | undefined>;

const BOM = "﻿";
const ALLOWLIST = "BOT_TEST_ALLOWLIST_USER_IDS";
const ALLOWLIST_EXAMPLE = "123456789012345678,234567890123456789";

/**
 * Um `.env` salvo com BOM (comum no Bloco de Notas) faz o Node ler a primeira chave como
 * `﻿NOME`: a variável some. Aqui ela é recuperada, e quem rodou é avisado.
 */
function readEnv(env: Env, name: string): { value: string | undefined; hadBom: boolean } {
  if (env[name] !== undefined) return { value: env[name], hadBom: false };
  const withBom = env[BOM + name];
  return { value: withBom, hadBom: withBom !== undefined };
}

type AllowlistResult = { ok: true; ids: Set<string>; warnings: string[] } | { ok: false; error: string };

// O valor nunca entra na mensagem: alguém pode ter colado o token no campo errado.
function parseAllowlist(raw: string | undefined): AllowlistResult {
  const ids = new Set<string>();
  const warnings: string[] = [];
  const items = (raw ?? "").split(",");
  for (const [index, item] of items.entries()) {
    const id = item.trim();
    if (id === "") continue;
    const position = index + 1;
    if (!/^\d+$/.test(id)) {
      return {
        ok: false,
        error:
          `${ALLOWLIST} malformado: o item ${position} não é um ID numérico do Discord. ` +
          `Use IDs separados por vírgula, como ${ALLOWLIST_EXAMPLE} (veja .env.example).`,
      };
    }
    if (id.length < 17 || id.length > 20) {
      warnings.push(
        `${ALLOWLIST}: o item ${position} tem ${id.length} dígitos; IDs do Discord têm de 17 a 20. Confira se o ID está completo.`,
      );
    }
    ids.add(id);
  }
  return { ok: true, ids, warnings };
}

export function loadConfig(env: Env): BotConfig {
  const tokenVar = readEnv(env, "DISCORD_BOT_TOKEN");
  const allowlistVar = readEnv(env, ALLOWLIST);
  const warnings: string[] = [];
  if (tokenVar.hadBom || allowlistVar.hadBom) {
    warnings.push(
      "o .env começa com BOM (marca de UTF-8); a primeira variável foi lida mesmo assim. Salve o arquivo como UTF-8 sem BOM.",
    );
  }

  // `trim` também descarta um BOM que tenha ficado no início do valor.
  const token = tokenVar.value?.trim();
  if (!token) {
    return {
      ok: false,
      error: "DISCORD_BOT_TOKEN não definido. Preencha o .env na raiz do projeto (veja .env.example).",
    };
  }

  const allowlist = parseAllowlist(allowlistVar.value);
  if (!allowlist.ok) return allowlist;
  // Sem allowlist, nada seria logado: falhar é mais claro do que ficar mudo.
  if (allowlist.ids.size === 0) {
    return {
      ok: false,
      error: `${ALLOWLIST} vazio. Informe ao menos um ID de usuário (veja .env.example).`,
    };
  }
  return { ok: true, token, allowlist: allowlist.ids, warnings: [...warnings, ...allowlist.warnings] };
}
