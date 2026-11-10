// F0-06/F1-49: resumo dos eventos no Neon por tipo, para conferir o roteiro na VM sem imprimir IDs.
import { expect, test } from "vitest";
import { formatEventSummary, parseSummaryArgs, type EventSummary } from "../src/event-summary.ts";

const empty: EventSummary = { byType: [], distinctUsers: 0, lastRecordedAt: null };

test("sem argumentos, olha as últimas 24 h", () => {
  expect(parseSummaryArgs([])).toEqual({ hours: 24 });
});

test("--hours aceita inteiros de 1 a 720", () => {
  expect(parseSummaryArgs(["--hours", "1"])).toEqual({ hours: 1 });
  expect(parseSummaryArgs(["--hours", "168"])).toEqual({ hours: 168 });
  expect(parseSummaryArgs(["--hours", "720"])).toEqual({ hours: 720 });
});

test("--hours inválido é recusado com mensagem própria", () => {
  const error = "use --hours com um número inteiro de 1 a 720 (padrão: 24).";
  for (const args of [["--hours"], ["--hours", "0"], ["--hours", "721"], ["--hours", "1.5"], ["--hours", "-3"], ["--hours", "abc"], ["--hours", ""]]) {
    expect(parseSummaryArgs(args)).toEqual({ error });
  }
});

test("argumento desconhecido é recusado sem repetir o valor (pode ser um ID colado por engano)", () => {
  const result = parseSummaryArgs(["123456789012345678"]);
  expect(result).toEqual({ error: "argumento desconhecido. Uso: neon summary [--hours N]." });
  expect(JSON.stringify(result)).not.toContain("123456789012345678");
});

test("sem eventos no período, diz isso", () => {
  expect(formatEventSummary(empty, 24)).toEqual(["Nenhum evento no Neon nas últimas 24 h."]);
});

test("lista todos os tipos na ordem fixa, com zero para os ausentes, e horários em UTC", () => {
  const summary: EventSummary = {
    byType: [
      { eventType: "voice_leave", count: 1, lastOccurredAt: new Date("2026-11-10T21:10:05.123Z") },
      { eventType: "voice_join", count: 2, lastOccurredAt: new Date("2026-11-10T21:03:12Z") },
      { eventType: "bot_start", count: 1, lastOccurredAt: new Date("2026-11-10T20:00:00Z") },
    ],
    distinctUsers: 1,
    lastRecordedAt: new Date("2026-11-10T21:10:06Z"),
  };
  expect(formatEventSummary(summary, 1)).toEqual([
    "Eventos no Neon na última 1 h (horários em UTC):",
    "  voice_join         2  último em 2026-11-10 21:03:12",
    "  voice_leave        1  último em 2026-11-10 21:10:05",
    "  voice_move         0",
    "  voice_present      0",
    "  bot_start          1  último em 2026-11-10 20:00:00",
    "  bot_disconnect     0",
    "  bot_resume         0",
    "  bot_heartbeat      0",
    "  bot_stop           0",
    "Total: 4. Pessoas distintas: 1. Última gravação no banco: 2026-11-10 21:10:06.",
  ]);
});

test("tipo fora da lista conhecida aparece no fim, para não sumir da contagem", () => {
  const summary: EventSummary = {
    byType: [{ eventType: "voice_new_kind", count: 3, lastOccurredAt: new Date("2026-11-10T00:00:00Z") }],
    distinctUsers: 0,
    lastRecordedAt: new Date("2026-11-10T00:00:01Z"),
  };
  const lines = formatEventSummary(summary, 48);
  expect(lines[0]).toBe("Eventos no Neon nas últimas 48 h (horários em UTC):");
  expect(lines.at(-2)).toBe("  voice_new_kind     3  último em 2026-11-10 00:00:00");
  expect(lines.at(-1)).toBe("Total: 3. Pessoas distintas: 0. Última gravação no banco: 2026-11-10 00:00:01.");
});
