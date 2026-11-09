import { describe, expect, test } from "vitest";
import { findErrorCode, isRejectedRowCode } from "../src/index.ts";

describe("findErrorCode", () => {
  test("acha o SQLSTATE no `cause` do erro do Drizzle", () => {
    const driver = Object.assign(new Error("valor 123456789012345678 inválido"), { code: "23514" });
    const drizzle = new Error("Failed query: insert ... params: 123456789012345678", { cause: driver });
    expect(findErrorCode(drizzle)).toBe("23514");
  });

  test("acha o código de rede direto no erro", () => {
    expect(findErrorCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("ECONNREFUSED");
  });

  test("ignora código que não parece código (poderia ser um valor)", () => {
    expect(findErrorCode({ code: "id 123 do usuário" })).toBeUndefined();
    expect(findErrorCode({ code: 42 })).toBeUndefined();
  });

  test("não entra em laço com `cause` circular", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(findErrorCode(error)).toBeUndefined();
  });

  test("aceita valores que não são objetos", () => {
    expect(findErrorCode(undefined)).toBeUndefined();
    expect(findErrorCode("texto")).toBeUndefined();
  });
});

describe("isRejectedRowCode", () => {
  test.each(["22P02", "22001", "23505", "23514", "23502"])("%s: a linha foi recusada", (code) => {
    expect(isRejectedRowCode(code)).toBe(true);
  });

  test.each(["08006", "57P01", "53300", "28P01", "42P01", "ECONNREFUSED", "ETIMEDOUT", undefined])(
    "%s: falha do banco ou da conexão, não da linha",
    (code) => {
      expect(isRejectedRowCode(code)).toBe(false);
    },
  );
});
