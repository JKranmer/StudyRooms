import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DiskQueue, PENDING_FILE, QUARANTINE_FILE } from "./event-queue.ts";
import { discardQuarantine, forgetInQueue, requeueRejected, summarizeQuarantine } from "./quarantine.ts";
import { toQueuedEvent, type QueuedEvent } from "./raw-event.ts";

const ME = "100000000000000111";
const OTHER = "100000000000000222";
const GUILD = "900000000000000900";
const SALA = "500000000000000501";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bot-quarentena-"));
  dirs.push(dir);
  return dir;
}

let n = 0;
function joinEvent(user: string): QueuedEvent {
  n += 1;
  return toQueuedEvent(
    {
      eventType: "voice_join",
      guildId: GUILD,
      discordUserId: user,
      fromChannelId: null,
      toChannelId: SALA,
      occurredAt: new Date(Date.UTC(2026, 10, 9, 12, 0, n)),
    },
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  );
}

const rejected = (event: QueuedEvent, code: string, at: string) =>
  JSON.stringify({ reason: "recusado_pelo_banco", code, at, event });
const unreadable = (line: string, at: string) => JSON.stringify({ reason: "linha_ilegivel", at, line });

function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "") : [];
}

test("resumo sem quarentena: zero, sem erro", () => {
  assert.deepEqual(summarizeQuarantine(tempDir()), { total: 0, byReason: {}, byCode: {}, first: null, last: null, invalid: 0 });
});

test("resumo conta por motivo e por código, com o período, sem nenhum ID", () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, QUARANTINE_FILE),
    [
      rejected(joinEvent(ME), "23514", "2026-11-09T10:00:00.000Z"),
      rejected(joinEvent(OTHER), "23514", "2026-11-09T11:00:00.000Z"),
      rejected(joinEvent(ME), "22P02", "2026-11-09T12:00:00.000Z"),
      unreadable(`{"idempotencyKey":"x","discordUserId":"${ME}"`, "2026-11-08T09:00:00.000Z"),
      "lixo que nem é JSON",
      "",
    ].join("\n"),
  );
  const summary = summarizeQuarantine(dir);
  assert.deepEqual(summary, {
    total: 5,
    byReason: { recusado_pelo_banco: 3, linha_ilegivel: 1 },
    byCode: { "23514": 2, "22P02": 1 },
    first: "2026-11-08T09:00:00.000Z",
    last: "2026-11-09T12:00:00.000Z",
    invalid: 1,
  });
  assert.ok(!JSON.stringify(summary).includes(ME));
});

test("reenfileirar devolve os recusados ao início da fila e mantém o resto na quarentena", () => {
  const dir = tempDir();
  const [a, b, pending] = [joinEvent(ME), joinEvent(OTHER), joinEvent(ME)];
  DiskQueue.open(dir).queue.append(pending);
  const damaged = unreadable("cortada", "2026-11-09T10:00:00.000Z");
  writeFileSync(
    join(dir, QUARANTINE_FILE),
    `${rejected(a, "23514", "2026-11-09T10:00:00.000Z")}\n${damaged}\n${rejected(b, "23514", "2026-11-09T10:00:01.000Z")}\n`,
  );
  assert.equal(requeueRejected(dir), 2);
  assert.deepEqual(DiskQueue.open(dir).queue.peek(10), [a, b, pending]);
  assert.deepEqual(lines(join(dir, QUARANTINE_FILE)), [damaged]);
});

test("reenfileirar sem recusados não mexe em nada", () => {
  const dir = tempDir();
  const damaged = unreadable("cortada", "2026-11-09T10:00:00.000Z");
  writeFileSync(join(dir, QUARANTINE_FILE), `${damaged}\n`);
  assert.equal(requeueRejected(dir), 0);
  assert.ok(!existsSync(join(dir, PENDING_FILE)));
  assert.deepEqual(lines(join(dir, QUARANTINE_FILE)), [damaged]);
});

test("esquecer tira a pessoa da fila e da quarentena, inclusive de linha ilegível, e preserva os outros", () => {
  const dir = tempDir();
  const [mine, other, mineRejected, otherRejected] = [joinEvent(ME), joinEvent(OTHER), joinEvent(ME), joinEvent(OTHER)];
  const { queue } = DiskQueue.open(dir);
  queue.append(mine);
  queue.append(other);
  const otherLine = rejected(otherRejected, "23514", "2026-11-09T10:00:00.000Z");
  writeFileSync(
    join(dir, QUARANTINE_FILE),
    [
      rejected(mineRejected, "23514", "2026-11-09T10:00:00.000Z"),
      unreadable(`{"discordUserId":"${ME}","cort`, "2026-11-09T10:00:00.000Z"),
      otherLine,
    ].join("\n") + "\n",
  );
  assert.deepEqual(forgetInQueue(dir, ME), { pending: 1, quarantine: 2 });
  assert.deepEqual(DiskQueue.open(dir).queue.peek(10), [other]);
  assert.deepEqual(lines(join(dir, QUARANTINE_FILE)), [otherLine]);
  assert.ok(!readFileSync(join(dir, PENDING_FILE), "utf8").includes(ME));
});

test("esquecer não apaga quem tem um ID mais longo que contém o ID pedido", () => {
  const dir = tempDir();
  const longer = joinEvent(`99${ME}`);
  DiskQueue.open(dir).queue.append(longer);
  assert.deepEqual(forgetInQueue(dir, ME), { pending: 0, quarantine: 0 });
  assert.deepEqual(DiskQueue.open(dir).queue.peek(10), [longer]);
});

test("esquecer recusa ID inválido", () => {
  assert.throws(() => forgetInQueue(tempDir(), "123"), /ID do Discord/);
});

test("descartar apaga a quarentena e devolve quantas linhas tinha", () => {
  const dir = tempDir();
  writeFileSync(join(dir, QUARANTINE_FILE), `${unreadable("a", "2026-11-09T10:00:00.000Z")}\n${unreadable("b", "2026-11-09T10:00:00.000Z")}\n`);
  assert.equal(discardQuarantine(dir), 2);
  assert.ok(!existsSync(join(dir, QUARANTINE_FILE)));
  assert.equal(discardQuarantine(dir), 0);
});
