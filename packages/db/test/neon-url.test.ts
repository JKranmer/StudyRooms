import { expect, test } from "vitest";
import { checkNeonUrl } from "../src/neon-url.ts";

const HOST = "ep-cool-name-123456.us-east-1.aws.neon.tech";

test("aceita a URL do Neon com sslmode=require ou verify-full", () => {
  expect(checkNeonUrl("NEON_ADMIN_URL", `postgresql://dono:x@${HOST}/neondb?sslmode=require`)).toEqual({ errors: [], warnings: [] });
  expect(checkNeonUrl("NEON_BOT_URL", `postgres://bot:x@${HOST}/neondb?sslmode=verify-full`)).toEqual({ errors: [], warnings: [] });
});

test("ausente ou vazia", () => {
  expect(checkNeonUrl("NEON_ADMIN_URL", undefined).errors).toEqual(["NEON_ADMIN_URL não definida. Veja docs/runbooks/neon.md."]);
  expect(checkNeonUrl("NEON_ADMIN_URL", "  ").errors).toEqual(["NEON_ADMIN_URL não definida. Veja docs/runbooks/neon.md."]);
});

test("sem SSL obrigatório é recusada", () => {
  for (const query of ["", "?sslmode=disable", "?sslmode=prefer", "?channel_binding=require"]) {
    expect(checkNeonUrl("NEON_BOT_URL", `postgres://bot:x@${HOST}/neondb${query}`).errors).toEqual([
      "NEON_BOT_URL sem SSL obrigatório: use ?sslmode=verify-full (ou require) no fim da URL (veja docs/runbooks/neon.md).",
    ]);
  }
});

test("esquema errado ou URL malformada é recusada, sem repetir o valor", () => {
  const secret = "senha-secreta";
  const result = checkNeonUrl("NEON_BOT_URL", `mysql://bot:${secret}@${HOST}/neondb?sslmode=require`);
  expect(result.errors).toEqual(["NEON_BOT_URL inválida: deve começar com postgres:// ou postgresql://."]);
  expect(JSON.stringify(checkNeonUrl("NEON_BOT_URL", `postgres://bot:${secret}@[malformada/x?sslmode=require`))).not.toContain(secret);
  expect(checkNeonUrl("NEON_BOT_URL", "postgres://[malformada").errors).toEqual(["NEON_BOT_URL inválida: não é uma URL."]);
});

test("host local é recusado: evita apontar o comando do Neon para o banco local por engano", () => {
  expect(checkNeonUrl("NEON_ADMIN_URL", "postgres://u:x@127.0.0.1:5432/studyrooms?sslmode=require").errors).toEqual([
    "NEON_ADMIN_URL aponta para a máquina local; use a conexão do Neon.",
  ]);
  expect(checkNeonUrl("NEON_ADMIN_URL", "postgres://u:x@localhost/studyrooms?sslmode=require").errors.length).toBe(1);
});

test("conexão com pooler: aviso para o admin (migrations pedem conexão direta)", () => {
  const pooled = `postgres://dono:x@ep-cool-name-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`;
  expect(checkNeonUrl("NEON_ADMIN_URL", pooled)).toEqual({
    errors: [],
    warnings: ["NEON_ADMIN_URL usa o pooler (-pooler no host); para migrations e papéis, prefira a conexão direta."],
  });
  expect(checkNeonUrl("NEON_BOT_URL", pooled).warnings).toEqual([]);
});
