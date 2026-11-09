// Disco cheio de verdade: precisa de uma pasta num sistema de arquivos pequeno (por exemplo, tmpfs
// de 256 KB no Linux), indicada em BOT_TEST_SMALL_DIR. Sem ela, o teste é pulado. Como rodar:
//   docker build -f apps/bot/Dockerfile --target test -t studyrooms-bot:test .
//   docker run --rm --tmpfs /q:size=256k,uid=1000 -e BOT_TEST_SMALL_DIR=/q -v <apps/bot/test>:/app/apps/bot/test:ro \
//     -w /app/apps/bot studyrooms-bot:test node --test test/disk-full.integration.test.ts
import assert from "node:assert/strict";
import { closeSync, mkdirSync, openSync, rmSync, statSync, truncateSync, writeSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DiskQueue } from "../src/event-queue.ts";
import { botMarker, toQueuedEvent, type QueuedEvent } from "../src/raw-event.ts";

const SMALL_DIR = process.env.BOT_TEST_SMALL_DIR;

let n = 0;
function event(): QueuedEvent {
  n += 1;
  return toQueuedEvent(
    botMarker("bot_heartbeat", new Date(Date.UTC(2026, 10, 9, 0, 0, 0, n))),
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  );
}

/** Ocupa o disco até não caber mais nada e devolve `leave` bytes livres. */
function fill(path: string, leave: number): void {
  const fd = openSync(path, "w");
  const block = Buffer.alloc(1024, 120);
  try {
    for (;;) writeSync(fd, block);
  } catch {
    // disco cheio
  } finally {
    closeSync(fd);
  }
  truncateSync(path, Math.max(0, statSync(path).size - leave));
}

test("disco cheio de verdade: a fila nunca fica cortada nem perde o que já estava nela", { skip: !SMALL_DIR }, () => {
  const dir = join(SMALL_DIR!, `fila-${process.pid}`);
  const filler = join(SMALL_DIR!, `enchimento-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    const { queue } = DiskQueue.open(dir);
    const accepted: QueuedEvent[] = [];
    for (let i = 0; i < 20; i += 1) {
      const e = event();
      queue.append(e);
      accepted.push(e);
    }
    fill(filler, 300);

    // Append com pouco espaço: cada evento entra inteiro ou lança, sem deixar linha cortada.
    let failed = 0;
    for (let i = 0; i < 20; i += 1) {
      const e = event();
      try {
        queue.append(e);
        accepted.push(e);
      } catch (error) {
        assert.equal((error as { code?: string }).code, "ENOSPC");
        failed += 1;
      }
    }
    assert.ok(failed > 0, "o disco deveria ter enchido");
    let reopened = DiskQueue.open(dir);
    assert.equal(reopened.damaged, 0, "linha cortada na fila");
    assert.deepEqual(reopened.queue.peek(1000), accepted);

    // Regravação (drop) sem espaço para o temporário: lança e mantém a fila inteira.
    assert.throws(() => queue.drop(1), { code: "ENOSPC" });
    assert.equal(queue.size, accepted.length);
    reopened = DiskQueue.open(dir);
    assert.equal(reopened.damaged, 0);
    assert.deepEqual(reopened.queue.peek(1000), accepted, "a fila foi trocada por um arquivo cortado");

    // Com espaço de volta, tudo segue normal.
    rmSync(filler);
    const extra = event();
    queue.append(extra);
    queue.drop(2);
    reopened = DiskQueue.open(dir);
    assert.equal(reopened.damaged, 0);
    assert.deepEqual(reopened.queue.peek(1000), [...accepted.slice(2), extra]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(filler, { force: true });
  }
});
