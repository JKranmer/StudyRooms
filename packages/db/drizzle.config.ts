import { defineConfig } from "drizzle-kit";

// Só para `drizzle-kit generate`, que não precisa de conexão. As migrations são aplicadas por
// `pnpm --filter @studyrooms/db migrate` (src/migrate-cli.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  strict: true,
});
