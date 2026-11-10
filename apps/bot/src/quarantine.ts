import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PENDING_FILE, QUARANTINE_FILE, replaceFile } from "./event-queue.ts";
import { parseQueuedEvent } from "./raw-event.ts";

/**
 * Ferramentas para a quarentena da fila em disco (runbook do Neon, F1-48). Só `summarizeQuarantine`
 * pode rodar com o bot ligado; as outras regravam a fila e exigem o bot parado, porque a fila não
 * tem trava contra dois processos. Nenhuma imprime IDs do Discord.
 */

type Entry = { reason?: unknown; code?: unknown; at?: unknown; event?: unknown; line?: unknown };

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
}

function parseEntry(line: string): Entry | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" ? (value as Entry) : null;
  } catch {
    return null;
  }
}

const text = (lines: string[]) => lines.map((line) => `${line}\n`).join("");

export type QuarantineSummary = {
  total: number;
  byReason: Record<string, number>;
  byCode: Record<string, number>;
  first: string | null;
  last: string | null;
  /** Linhas que nem são JSON (não deveriam existir). */
  invalid: number;
};

export function summarizeQuarantine(dir: string): QuarantineSummary {
  const summary: QuarantineSummary = { total: 0, byReason: {}, byCode: {}, first: null, last: null, invalid: 0 };
  for (const line of readLines(join(dir, QUARANTINE_FILE))) {
    summary.total += 1;
    const entry = parseEntry(line);
    if (!entry || typeof entry.reason !== "string") {
      summary.invalid += 1;
      continue;
    }
    summary.byReason[entry.reason] = (summary.byReason[entry.reason] ?? 0) + 1;
    if (typeof entry.code === "string") summary.byCode[entry.code] = (summary.byCode[entry.code] ?? 0) + 1;
    if (typeof entry.at === "string") {
      if (summary.first === null || entry.at < summary.first) summary.first = entry.at;
      if (summary.last === null || entry.at > summary.last) summary.last = entry.at;
    }
  }
  return summary;
}

/**
 * Devolve ao início da fila os eventos recusados pelo banco, depois de corrigida a causa (por
 * exemplo, uma migration). Linhas ilegíveis ficam na quarentena. Reenviar é seguro: a chave de
 * idempotência impede duplicata. Se o banco recusar de novo, o evento volta para a quarentena.
 */
export function requeueRejected(dir: string): number {
  const quarantinePath = join(dir, QUARANTINE_FILE);
  const pendingPath = join(dir, PENDING_FILE);
  const keep: string[] = [];
  const requeue: string[] = [];
  for (const line of readLines(quarantinePath)) {
    const entry = parseEntry(line);
    const event = entry?.reason === "recusado_pelo_banco" ? parseQueuedEvent(entry.event) : null;
    if (event) requeue.push(JSON.stringify(event));
    else keep.push(line);
  }
  if (requeue.length === 0) return 0;
  // Primeiro a fila, depois a quarentena: se parar no meio, o evento fica nos dois, e o reenvio
  // não duplica no banco.
  replaceFile(dir, pendingPath, text(requeue) + text(readLines(pendingPath)));
  replaceFile(dir, quarantinePath, text(keep));
  return requeue.length;
}

/**
 * Exclusão a pedido (D-47): tira da fila e da quarentena tudo o que é da pessoa, inclusive linha
 * ilegível que contenha o ID. Os eventos dela já gravados no banco são apagados à parte.
 */
export function forgetInQueue(dir: string, discordUserId: string): { pending: number; quarantine: number } {
  if (!/^[0-9]{17,20}$/.test(discordUserId)) {
    throw new Error("ID do Discord inválido: use só os dígitos do ID (17 a 20).");
  }
  // Sem dígito colado dos lados: um ID mais curto pode estar dentro do ID mais longo de outra pessoa.
  const pattern = new RegExp(`(?<![0-9])${discordUserId}(?![0-9])`);
  const result = { pending: 0, quarantine: 0 };
  for (const [file, key] of [[PENDING_FILE, "pending"], [QUARANTINE_FILE, "quarantine"]] as const) {
    const path = join(dir, file);
    const lines = readLines(path);
    const keep = lines.filter((line) => !pattern.test(line));
    result[key] = lines.length - keep.length;
    if (result[key] > 0) replaceFile(dir, path, text(keep));
  }
  return result;
}

/** Apaga a quarentena (decisão de descartar o que ela tem). Devolve quantas linhas havia. */
export function discardQuarantine(dir: string): number {
  const path = join(dir, QUARANTINE_FILE);
  const count = readLines(path).length;
  rmSync(path, { force: true });
  return count;
}
