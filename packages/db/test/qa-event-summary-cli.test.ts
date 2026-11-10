// F0-06 (QA): `neon summary` no CLI, sem banco e sem ler o .env (o processo é chamado direto, sem
// --env-file). Confere que argumento inválido sai com 78 sem repetir o valor e que o comando só
// aceita a conexão só leitura do backup (NEON_BACKUP_URL), nunca a do dono.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { formatEventSummary, parseSummaryArgs } from "../src/event-summary.ts";

const CLI = fileURLToPath(new URL("../src/neon-cli.ts", import.meta.url));
const ID = "123456789012345678";
const ADMIN_URL = "postgres://neondb_owner:npg_SegredoDoDono1@ep-x-123.sa-east-1.aws.neon.tech/neondb?sslmode=require";

function run(args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = { ...extraEnv };
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const result = spawnSync(process.execPath, [CLI, "summary", ...args], { env, encoding: "utf8", timeout: 20_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test.each([
  [[ID]],
  [["--hours", ID]],
  [["--hours=" + ID]],
  [["--hours", "24", ID]],
  [["--hours", `24${ID}`]],
  [["--hours", "1e3"]],
  [["--hours", " 24"]],
  [["--hours", "٢٤"]], // dígitos arábicos: não são [0-9]
])("argumento inválido %j sai com 78 e não repete o valor", (args) => {
  const { status, output } = run(args, { NEON_ADMIN_URL: ADMIN_URL });
  expect(status).toBe(78);
  expect(output).toMatch(/^erro: /);
  expect(output).not.toContain(ID);
  expect(output).not.toContain("npg_SegredoDoDono1");
});

test("sem NEON_BACKUP_URL, recusa com 78 em vez de cair na conexão do dono", () => {
  const { status, output } = run(["--hours", "1"], { NEON_ADMIN_URL: ADMIN_URL, NEON_BOT_URL: ADMIN_URL });
  expect(status).toBe(78);
  expect(output).toContain("NEON_BACKUP_URL");
  expect(output).not.toContain("npg_SegredoDoDono1");
});

test("NEON_BACKUP_URL local ou sem SSL é recusada sem ecoar a URL", () => {
  for (const url of [
    "postgres://studyrooms_backup:segredoLocal9@localhost:5432/neondb",
    "postgres://studyrooms_backup:segredoLocal9@ep-y.sa-east-1.aws.neon.tech/neondb",
  ]) {
    const { status, output } = run([], { NEON_BACKUP_URL: url });
    expect(status).toBe(78);
    expect(output).not.toContain("segredoLocal9");
  }
});

test("--hours repetido fica com o último valor válido; zeros à esquerda são aceitos", () => {
  expect(parseSummaryArgs(["--hours", "5", "--hours", "6"])).toEqual({ hours: 6 });
  expect(parseSummaryArgs(["--hours", "0024"])).toEqual({ hours: 24 });
  expect(parseSummaryArgs(["--hours", "5", "--hours", "0"])).toHaveProperty("error");
});

test("contagens com 4 dígitos (720 h de heartbeat) e janelas sem último horário não quebram a linha", () => {
  const lines = formatEventSummary(
    {
      byType: [{ eventType: "bot_heartbeat", count: 1440, lastOccurredAt: new Date("2026-11-10T23:59:59.999Z") }],
      distinctUsers: 0,
      lastRecordedAt: null,
    },
    720,
  );
  expect(lines).toContain("  bot_heartbeat    1440  último em 2026-11-10 23:59:59");
  expect(lines.at(-1)).toBe("Total: 1440. Pessoas distintas: 0. Última gravação no banco: desconhecida.");
});
