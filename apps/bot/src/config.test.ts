import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_QUEUE_DIR, loadConfig } from "./config.ts";

const ID_A = "123456789012345678";
const ID_B = "234567890123456789";
const BOM = "﻿";
const DB_URL = "postgres://bot:senha-falsa@127.0.0.1:5432/studyrooms";
const DB = { BOT_DATABASE_URL: DB_URL };

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
    const result = loadConfig({ ...DB, DISCORD_BOT_TOKEN: token, BOT_TEST_ALLOWLIST_USER_IDS: ID_A });
    assert.match(errorOf(result), /DISCORD_BOT_TOKEN não definido/);
  }
});

test("allowlist vazia é erro, para o bot não ficar mudo", () => {
  const result = loadConfig({ ...DB, DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: " , " });
  assert.match(errorOf(result), /BOT_TEST_ALLOWLIST_USER_IDS vazio/);
});

test("configuração válida devolve token sem espaços, a allowlist e nenhum aviso", () => {
  const result = loadConfig({ ...DB, DISCORD_BOT_TOKEN: " t ", BOT_TEST_ALLOWLIST_USER_IDS: `${ID_A}, ${ID_B}` });
  assert.deepEqual(result, {
    ok: true,
    token: "t",
    allowlist: new Set([ID_A, ID_B]),
    databaseUrl: DB_URL,
    queueDir: DEFAULT_QUEUE_DIR,
    warnings: [],
  });
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
    const error = errorOf(loadConfig({ ...DB, DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: raw }));
    assert.match(error, /BOT_TEST_ALLOWLIST_USER_IDS malformado/, raw);
    assert.match(error, new RegExp(`item ${position} `), raw);
  }
});

test("a mensagem de allowlist malformada não ecoa o valor (pode ser um segredo colado por engano)", () => {
  const raw = `${ID_A},SEGREDO.colado-por-engano`;
  const error = errorOf(loadConfig({ ...DB, DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: raw }));
  assert.ok(!error.includes("SEGREDO"), error);
});

test("ID numérico com tamanho fora do de um snowflake gera aviso, sem impedir a subida", () => {
  const result = loadConfig({ ...DB, DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: `${ID_A},111` });
  const warnings = warningsOf(result);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /BOT_TEST_ALLOWLIST_USER_IDS: o item 2 tem 3 dígitos; IDs do Discord têm de 17 a 20/);
  assert.deepEqual(result.ok && [...result.allowlist], [ID_A, "111"]);
});

test("vírgula sobrando e espaços continuam aceitos, sem aviso", () => {
  const result = loadConfig({ ...DB, DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: ` ${ID_A}, ,${ID_B},` });
  assert.deepEqual(warningsOf(result), []);
  assert.deepEqual(result.ok && [...result.allowlist], [ID_A, ID_B]);
});

test(".env com BOM: a primeira variável é lida mesmo com o BOM no nome, com aviso", () => {
  for (const env of [
    { [`${BOM}DISCORD_BOT_TOKEN`]: "t", BOT_TEST_ALLOWLIST_USER_IDS: ID_A },
    { DISCORD_BOT_TOKEN: "t", [`${BOM}BOT_TEST_ALLOWLIST_USER_IDS`]: ID_A },
  ]) {
    const result = loadConfig({ ...DB, ...env });
    assert.equal(result.ok && result.token, "t");
    assert.deepEqual(result.ok && [...result.allowlist], [ID_A]);
    const warnings = warningsOf(result);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /BOM/);
    assert.match(warnings[0]!, /UTF-8 sem BOM/);
  }
});

test("BOM no início do valor também é descartado", () => {
  const result = loadConfig({ ...DB, DISCORD_BOT_TOKEN: `${BOM}t`, BOT_TEST_ALLOWLIST_USER_IDS: `${BOM}${ID_A}` });
  assert.equal(result.ok && result.token, "t");
  assert.deepEqual(result.ok && [...result.allowlist], [ID_A]);
});

test("a variável sem BOM prevalece sobre a com BOM", () => {
  const result = loadConfig({ ...DB,
    [`${BOM}DISCORD_BOT_TOKEN`]: "com-bom",
    DISCORD_BOT_TOKEN: "sem-bom",
    BOT_TEST_ALLOWLIST_USER_IDS: ID_A,
  });
  assert.equal(result.ok && result.token, "sem-bom");
});

// F1-47: banco e fila em disco.
test("sem BOT_DATABASE_URL o bot não sobe, para não ficar coletando sem gravar", () => {
  for (const url of [undefined, "", "  "]) {
    const error = errorOf(loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: ID_A, BOT_DATABASE_URL: url }));
    assert.match(error, /BOT_DATABASE_URL não definida/);
  }
});

test("BOT_DATABASE_URL que não é postgres:// é erro que não ecoa o valor (tem senha)", () => {
  for (const url of ["mysql://u:SENHA@h/db", "SENHA-colada", "http://u:SENHA@h/db"]) {
    const error = errorOf(loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: ID_A, BOT_DATABASE_URL: url }));
    assert.match(error, /BOT_DATABASE_URL inválida/);
    assert.ok(!error.includes("SENHA"), error);
  }
});

test("aceita postgres:// e postgresql://, e BOT_QUEUE_DIR troca a pasta da fila", () => {
  const result = loadConfig({
    DISCORD_BOT_TOKEN: "t",
    BOT_TEST_ALLOWLIST_USER_IDS: ID_A,
    BOT_DATABASE_URL: " postgresql://u:p@ep-x.neon.tech/db?sslmode=require ",
    BOT_QUEUE_DIR: " /var/lib/studyrooms-bot ",
  });
  assert.equal(result.ok && result.databaseUrl, "postgresql://u:p@ep-x.neon.tech/db?sslmode=require");
  assert.equal(result.ok && result.queueDir, "/var/lib/studyrooms-bot");
});

test("a pasta padrão da fila fica em .data/bot-queue, na raiz do repositório", () => {
  assert.match(DEFAULT_QUEUE_DIR.replaceAll("\\", "/"), /\/\.data\/bot-queue$/);
});

test(".env com BOM e BOT_DATABASE_URL na primeira linha: a variável é lida, com aviso", () => {
  const result = loadConfig({ DISCORD_BOT_TOKEN: "t", BOT_TEST_ALLOWLIST_USER_IDS: ID_A, [`${BOM}BOT_DATABASE_URL`]: DB_URL });
  assert.equal(result.ok && result.databaseUrl, DB_URL);
  assert.match(warningsOf(result)[0]!, /BOM/);
});
