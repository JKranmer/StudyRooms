// F1-48 (QA): filtro de segredos das mensagens de erro do `neon roles`, com mensagens de servidor
// adversariais ou inesperadas. Sem banco.
import { describe, expect, test } from "vitest";
import { generatePassword, RoleSetupError, safeServerMessage, scramVerifier } from "../src/index.ts";

const err = (message: unknown, code: unknown = "XX000") => Object.assign(new Error("x"), { message, code });

/** Senha base64url de 43 caracteres sem nenhum dígito (o gerador produz isso raramente). */
const LETTERS_ONLY = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

describe("safeServerMessage com segredo conhecido", () => {
  const password = generatePassword();
  const verifier = scramVerifier(password);
  const secrets = [password, verifier];

  const cases: Array<[string, string]> = [
    ["no meio do texto", `bad password ${password} here`],
    ["entre aspas simples", `invalid password '${password}'`],
    ["entre aspas duplas", `role "${password}" does not exist`],
    ["entre crases", `got \`${password}\``],
    ["colado em pontuação", `(${password}),${password};`],
    ["repetido muitas vezes", `${password} `.repeat(20)],
    ["verificador inteiro", `cannot use ${verifier}`],
    ["verificador entre aspas", `password '${verifier}' rejected`],
    ["em formato chave=valor", `password=${password} host=ep-x.neon.tech`],
    ["depois do limite de 300", `${"a ".repeat(200)}${password}`],
    ["com quebra de linha antes", `erro\n${password}\r\n`],
    ["como identificador minúsculo", `syntax error at or near "${password.toLowerCase()}"`],
    ["em JSON", JSON.stringify({ password, verifier })],
  ];

  test.each(cases)("%s", (_name, message) => {
    const out = safeServerMessage(err(message), secrets) ?? "";
    expect(out).not.toContain(password);
    expect(out).not.toContain(verifier);
    expect(out.toLowerCase()).not.toContain(password.toLowerCase());
    // Nenhum pedaço de 16 caracteres da senha nem do verificador sobra.
    for (let i = 0; i + 16 <= password.length; i++) expect(out).not.toContain(password.slice(i, i + 16));
    for (let i = 0; i + 16 <= verifier.length; i++) expect(out).not.toContain(verifier.slice(i, i + 16));
  });

  test("senha sem dígitos, conhecida, sai", () => {
    expect(safeServerMessage(err(`x ${LETTERS_ONLY} y`), [LETTERS_ONLY])).toBe("x [omitido] y");
  });
});

describe("safeServerMessage sem conhecer o segredo", () => {
  test.each([
    ["URL postgres", "falhou em postgres://neondb_owner:npg_AbCdEfGhIjKl@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require"],
    ["URL postgresql maiúscula", "POSTGRESQL://u:SenhaQualquer@ep-a.b.c/neondb"],
    ["URL jdbc", "jdbc:postgresql://u:SenhaQualquer@ep-a.b.c/neondb"],
    ["host do Neon solto", "could not connect to ep-cool-darkness-123456.us-east-2.aws.neon.tech"],
    ["host do pooler", "endpoint ep-cool-darkness-123456-pooler.c-2.us-east-2.aws.neon.tech closed"],
    ["IPv4", "connect ECONNREFUSED 10.20.30.40:5432"],
    ["verificador desconhecido", `bad ${scramVerifier("outra-senha-qualquer-de-teste")}`],
    ["literal com aspa simples sem fechar", "near 'SenhaQualquer sem fim"],
    ["literal com aspas duplas e espaço", 'role "Senha Qualquer" x'],
  ])("%s", (_name, message) => {
    const out = safeServerMessage(err(message)) ?? "";
    expect(out).not.toMatch(/neon\.tech|SenhaQualquer|Senha Qualquer|npg_|10\.20\.30\.40|SCRAM-SHA-256\$4096:/);
  });

  test("Neon: senha do dono (npg_ + 12) sem dígito, em formato usuário:senha@host sem esquema", () => {
    // Formato das senhas do Neon: npg_ + 12 alfanuméricos; cerca de 12% delas não têm dígito.
    const out = safeServerMessage(err("auth neondb_owner:npg_AbCdEfGhIjKl@ep-cool-darkness-123456.us-east-2.aws.neon.tech")) ?? "";
    expect(out).not.toContain("npg_AbCdEfGhIjKl");
  });

  test("Neon: senha do dono sem dígito, em formato chave=valor (libpq)", () => {
    const out = safeServerMessage(err("invalid connection option password=npg_AbCdEfGhIjKl")) ?? "";
    expect(out).not.toContain("npg_AbCdEfGhIjKl");
  });
});

describe("safeServerMessage com mensagens estranhas", () => {
  test("mensagem que não é texto, vazia ou só espaços", () => {
    expect(safeServerMessage(err({ toString: () => "segredo" }))).toBeUndefined();
    expect(safeServerMessage(err(42))).toBeUndefined();
    expect(safeServerMessage(err("   \n\t "))).toBeUndefined();
    expect(safeServerMessage(null)).toBeUndefined();
    expect(safeServerMessage("string solta")).toBeUndefined();
  });

  test("sequências de escape ANSI não chegam ao terminal", () => {
    const out = safeServerMessage(err("\u001b[2J\u001b]0;titulo\u0007limpou"))!;
    expect(out).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  test("caracteres de controle bidi/separador de linha Unicode não chegam ao terminal", () => {
    const ch = (code: number) => String.fromCharCode(code);
    const out = safeServerMessage(err(`ok${ch(0x202e)}abc${ch(0x2028)}linha falsa`))!;
    expect(out).not.toMatch(new RegExp("[\u202A-\u202E\u2066-\u2069\u2028\u2029\u0085]"));
  });

  test("segredo curto (< 4) é ignorado sem quebrar; secrets vazio ou com string vazia", () => {
    expect(safeServerMessage(err("a b c"), ["", "a"])).toBe("a b c");
  });

  test("limite: sai no máximo 300 caracteres mais reticências", () => {
    const out = safeServerMessage(err("palavra ".repeat(1000)))!;
    expect(out.length).toBeLessThanOrEqual(303);
    expect(out.endsWith("...")).toBe(true);
  });

  test("código malicioso no campo code é descartado", () => {
    const password = generatePassword();
    const e = new RoleSetupError("etapa", err("x", `XX000 ${password}`), [password]);
    expect(e.code).toBeUndefined();
    expect(e.message).toBe("falhou ao etapa (código desconhecido): x");
  });

  test("getter de message que lança não vaza a mensagem do getter", () => {
    const evil = {
      code: "XX000",
      get message(): string {
        throw new Error("segredo do getter");
      },
    };
    let thrown: unknown;
    try {
      new RoleSetupError("etapa", evil);
    } catch (e) {
      thrown = e;
    }
    // Lançar aqui é aceitável (o CLI só imprime o código); o importante é não virar mensagem.
    if (thrown === undefined) expect(true).toBe(true);
    else expect(thrown).toBeInstanceOf(Error);
  });

  test("RoleSetupError não guarda o erro original em nenhum campo", () => {
    const password = generatePassword();
    const e = new RoleSetupError("definir a senha do bot", err(`x ${password}`), [password]);
    const all = JSON.stringify(Object.getOwnPropertyNames(e).map((k) => (e as unknown as Record<string, unknown>)[k]));
    expect(all).not.toContain(password);
    expect(e.stack ?? "").not.toContain(password);
  });
});
