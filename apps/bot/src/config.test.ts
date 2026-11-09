import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.ts";

const ID_A = "123456789012345678";
const ID_B = "234567890123456789";
const BOM = "﻿";

function errorOf(result: ReturnType<typeof loadConfig>): string {
  assert.equal(result.ok, false);
  return result.ok ? "" : result.error;
}

function warningsOf(result: ReturnType<typeof loadConfig>): string[] {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result.ok ? result.warnings : [];
}

test("token ausente ou em branco é erro que não ecoa valores", () => {
  for (const token of [undefined, "", "   "]) {
    const result = loadConfig({ DISCORD_BOT_TOKEN: token, BOT_TEST_ALLOWLIST_USER_IDS: ID_A });
    assert.match(errorOf(result), /DISCORD_BOT_TOKEN não definido/);
  }
});

test("allowlist vazia é erro, para o bot não ficar mudo", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: " , " });
  assert.match(errorOf(result), /BOT_TEST_ALLOWLIST_USER_IDS vazio/);
});

test("configuração válida devolve token sem espaços, a allowlist e nenhum aviso", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: " t ", BOT_TEST_ALLOWLIST_USER_IDS: `${ID_A}, ${ID_B}` });
  assert.deepEqual(result, { ok: true, token: "t", allowlist: new Set([ID_A, ID_B]), warnings: [] });
});

test("allowlist com item que não é ID numérico é erro com a posição do item", () => {
  const cases: [string, number][] = [
    [`${ID_A};${ID_B}`, 1], // separador errado
    [`${ID_A}, fulano`, 2], // nome em vez de ID
    [`<@${ID_A}>`, 1], // menção copiada do Discord
    [`"${ID_A}", ${ID_B}`, 1], // aspas que sobraram no meio
    [`${ID_A} ${ID_B}`, 1], // espaço como separador
  ];
  for (const [raw, position] of cases) {
    const error = errorOf(loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: raw }));
    assert.match(error, /BOT_TEST_ALLOWLIST_USER_IDS malformado/, raw);
    assert.match(error, new RegExp(`item ${position} `), raw);
  }
});

test("a mensagem de allowlist malformada não ecoa o valor (pode ser um segredo colado por engano)", () => {
  const raw = `${ID_A},SEGREDO.colado-por-engano`;
  const error = errorOf(loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: raw }));
  assert.ok(!error.includes("SEGREDO"), error);
});

test("ID numérico com tamanho fora do de um snowflake gera aviso, sem impedir a subida", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: `${ID_A},111` });
  const warnings = warningsOf(result);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /BOT_TEST_ALLOWLIST_USER_IDS: o item 2 tem 3 dígitos; IDs do Discord têm de 17 a 20/);
  assert.deepEqual(result.ok && [...result.allowlist], [ID_A, "111"]);
});

test("vírgula sobrando e espaços continuam aceitos, sem aviso", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: ` ${ID_A}, ,${ID_B},` });
  assert.deepEqual(warningsOf(result), []);
  assert.deepEqual(result.ok && [...result.allowlist], [ID_A, ID_B]);
});

test(".env com BOM: a primeira variável é lida mesmo com o BOM no nome, com aviso", () => {
  for (const env of [
    { [`${BOM}DISCORD_BOT_TOKEN`]: "t", BOT_TEST_ALLOWLIST_USER_IDS: ID_A },
    { DISCORD_BOT_TOKEN: "t", [`${BOM}BOT_TEST_ALLOWLIST_USER_IDS`]: ID_A },
  ]) {
    const result = loadConfig(env);
    assert.equal(result.ok && result.token, "t");
    assert.deepEqual(result.ok && [...result.allowlist], [ID_A]);
    const warnings = warningsOf(result);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /BOM/);
    assert.match(warnings[0]!, /UTF-8 sem BOM/);
  }
});

test("BOM no início do valor também é descartado", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: `${BOM}t`, BOT_TEST_ALLOWLIST_USER_IDS: `${BOM}${ID_A}` });
  assert.equal(result.ok && result.token, "t");
  assert.deepEqual(result.ok && [...result.allowlist], [ID_A]);
});

test("a variável sem BOM prevalece sobre a com BOM", () => {
  const result = loadConfig({
    [`${BOM}DISCORD_BOT_TOKEN`]: "com-bom",
    DISCORD_BOT_TOKEN: "sem-bom",
    BOT_TEST_ALLOWLIST_USER_IDS: ID_A,
  });
  assert.equal(result.ok && result.token, "sem-bom");
});
