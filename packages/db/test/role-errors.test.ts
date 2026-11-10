// F1-48: diagnóstico do `neon roles` sem vazar segredo. Sem banco.
import { describe, expect, test } from "vitest";
import { generatePassword, RoleSetupError, rolesSqlSteps, safeServerMessage, scramVerifier } from "../src/index.ts";

const dbError = (message: string, code = "XX000") => Object.assign(new Error(message), { code });

describe("safeServerMessage", () => {
  test("mantém a mensagem do Neon que não tem segredo", () => {
    expect(safeServerMessage(dbError("Neon only supports being given plaintext passwords"))).toBe(
      "Neon only supports being given plaintext passwords",
    );
    expect(safeServerMessage(dbError('permission denied to alter role "studyrooms_bot"'))).toBe(
      'permission denied to alter role "studyrooms_bot"',
    );
  });

  test("tira senha e verificador, conhecidos ou não", () => {
    const password = generatePassword();
    const verifier = scramVerifier(password);
    const known = safeServerMessage(dbError(`erro perto de ${password} e de ${verifier}`), [password, verifier]);
    expect(known).not.toContain(password);
    expect(known).not.toContain(verifier);
    // Mesmo sem saber o segredo, pedaços longos com cara de senha ou base64 saem.
    const unknown = safeServerMessage(dbError(`syntax error at or near ${password.slice(0, 30)} ${verifier.slice(0, 40)}`));
    expect(unknown).not.toContain(password.slice(0, 30));
    expect(unknown).not.toContain(verifier.slice(14, 40));
    expect(unknown).toMatch(/^syntax error at or near/);
  });

  test("tira literais entre aspas, URL e host", () => {
    const message = safeServerMessage(
      dbError(
        "falhou 'segredo curto' em postgresql://u:p@ep-x-1.us-east-1.aws.neon.tech/neondb host ep-cool-darkness.us-east-1.aws.neon.tech \"x y\"",
      ),
    )!;
    expect(message).not.toContain("segredo");
    expect(message).not.toContain("neon.tech");
    expect(message).not.toContain("u:p");
    expect(message).not.toContain("x y");
  });

  test("sem mensagem, undefined; mensagem enorme é cortada", () => {
    expect(safeServerMessage(undefined)).toBeUndefined();
    expect(safeServerMessage({ code: "XX000" })).toBeUndefined();
    expect(safeServerMessage(dbError("a ".repeat(500)))!.length).toBeLessThanOrEqual(303);
  });
});

describe("RoleSetupError", () => {
  test("leva a etapa, o código e a mensagem filtrada, sem o erro original", () => {
    const password = generatePassword();
    const error = new RoleSetupError("definir a senha do bot", dbError(`ruim: ${password}`), [password]);
    expect(error.stage).toBe("definir a senha do bot");
    expect(error.code).toBe("XX000");
    expect(error.message).toBe("falhou ao definir a senha do bot (código XX000): ruim: [omitido]");
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(password);
  });
});

describe("rolesSqlSteps", () => {
  test("divide roles.sql em etapas com nome, sem bloco vazio", () => {
    const steps = rolesSqlSteps();
    expect(steps.map((s) => s.stage)).toEqual([
      "criar os papéis",
      "ajustar NOINHERIT e o limite de conexões",
      "deixar o backup só leitura",
      "aplicar as permissões do bot",
      "aplicar as permissões do backup",
      "aplicar as permissões padrão do backup (ALTER DEFAULT PRIVILEGES)",
    ]);
    for (const step of steps) expect(step.sql.replace(/^--.*$/gm, "").trim()).not.toBe("");
  });

  test("os papéis nascem sem LOGIN e nenhuma etapa define senha", () => {
    const sql = rolesSqlSteps()
      .map((s) => s.sql.replace(/--.*$/gm, ""))
      .join("\n")
      .toLowerCase();
    expect(sql).toContain("create role studyrooms_bot nologin");
    expect(sql).toContain("create role studyrooms_backup nologin");
    expect(sql).not.toMatch(/password/);
    expect(sql).not.toMatch(/\blogin\b/);
  });

  test("recusa comando antes da primeira etapa", () => {
    expect(() => rolesSqlSteps("select 1;\n-- etapa: x\nselect 2;")).toThrow(/etapa/);
  });
});
