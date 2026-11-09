import { parseAllowlist } from "./voice-event.ts";

export type BotConfig =
  | { ok: true; token: string; allowlist: Set<string> }
  | { ok: false; error: string };

export function loadConfig(env: Record<string, string | undefined>): BotConfig {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      error: "DISCORD_BOT_TOKEN não definido. Preencha o .env na raiz do projeto (veja .env.example).",
    };
  }
  // Sem allowlist, nada seria logado: falhar é mais claro do que ficar mudo.
  const allowlist = parseAllowlist(env.BOT_TEST_ALLOWLIST_USER_IDS);
  if (allowlist.size === 0) {
    return {
      ok: false,
      error: "BOT_TEST_ALLOWLIST_USER_IDS vazio. Informe ao menos um ID de usuário (veja .env.example).",
    };
  }
  return { ok: true, token, allowlist };
}
