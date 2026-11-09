import { runMigrations } from "./migrate.ts";

// Uso: `pnpm --filter @studyrooms/db migrate`, com DATABASE_URL no `.env` da raiz.
// A URL nunca é impressa: ela contém a senha.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida. Veja o .env.example.");
  process.exit(78);
}

try {
  await runMigrations(url);
  console.log("Migrations em dia.");
} catch (error) {
  // Só o código (SQLSTATE como 28P01, ou de rede como ECONNREFUSED): a mensagem pode trazer
  // valores e detalhes da conexão. O Drizzle embrulha o erro do driver em `cause`.
  const code = findErrorCode(error);
  console.error(`Falha ao aplicar migrations${code ? ` (código ${code})` : ""}.`);
  process.exit(1);
}

function findErrorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && /^[A-Z0-9_]{2,32}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}
