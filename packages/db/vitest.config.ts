import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Os testes de integração sobem um Postgres no Docker; o primeiro pull da imagem pode demorar.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
