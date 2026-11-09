// Processo filho do teste de morte em pontos aleatórios (QA, F1-47): com o banco no ar, grava
// eventos sem parar e imprime "ok <chave>" só depois que `record` voltou (evento já no disco).
// O teste o mata com SIGKILL a qualquer momento. Uso: node kill-loop-child.ts <pasta> <url> <início|drain>
import { createDb, insertRawVoiceEvents } from "@studyrooms/db";
import { DiskQueue } from "../src/event-queue.ts";
import { createEventWriter } from "../src/event-writer.ts";
import { eventFromTransition, toRow } from "../src/raw-event.ts";

const [dir, url, mode] = process.argv.slice(2);
const { queue } = DiskQueue.open(dir!);
const database = createDb(url!, { pool: { max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 2_000 } });
let n = mode === "drain" ? 0 : Number(mode);
let lastKey = "";
const writer = createEventWriter({
  queue,
  insert: (events) => insertRawVoiceEvents(database.db, events.map(toRow)),
  log: () => {},
  now: () => new Date(),
  newKey: () => (lastKey = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  retryDelaysMs: [100],
});
writer.start();
if (mode !== "drain") {
  const tick = () => {
    for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i += 1) {
      const channel = `50000000000000000${n % 2}`;
      writer.record(eventFromTransition("900000000000000001", "100000000000000001", "join", null, channel, new Date())!);
      process.stdout.write(`ok ${lastKey}\n`);
      n += 1;
    }
    setTimeout(tick, Math.floor(Math.random() * 5));
  };
  tick();
}
setInterval(() => {}, 1_000);
