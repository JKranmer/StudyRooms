import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.ts";

test("token ausente ou em branco é erro que não ecoa valores", () => {
  for (const token of [undefined, "", "   "]) {
    const result = loadConfig({ DISCORD_BOT_TOKEN: token, BOT_TEST_ALLOWLIST_USER_IDS: "111" });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /DISCORD_BOT_TOKEN não definido/);
  }
});

test("allowlist vazia é erro, para o bot não ficar mudo", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: " , " });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /BOT_TEST_ALLOWLIST_USER_IDS vazio/);
});

test("configuração válida devolve token sem espaços e a allowlist", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: " t ", BOT_TEST_ALLOWLIST_USER_IDS: "111, 222" });
  assert.deepEqual(result, { ok: true, token: "t", allowlist: new Set(["111", "222"]) });
});
