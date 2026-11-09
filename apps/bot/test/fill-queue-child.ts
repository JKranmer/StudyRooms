// Processo filho do teste "matar com a fila cheia": grava N eventos com o banco fora e fica parado
// até ser morto (SIGKILL, sem chance de limpar nada). Uso: node fill-queue-child.ts <pasta> <url> <n>
import { randomUUID } from "node:crypto";
import { createDb, insertRawVoiceEvents } from "@studyrooms/db";
import { DiskQueue } from "../src/event-queue.ts";
import { createEventWriter } from "../src/event-writer.ts";
import { eventFromTransition, toRow } from "../src/raw-event.ts";

const [dir, url, count] = process.argv.slice(2);
const { queue } = DiskQueue.open(dir!);
const database = createDb(url!, { pool: { max: 1, connectionTimeoutMillis: 2_000 } });
const writer = createEventWriter({
  queue,
  insert: (events) => insertRawVoiceEvents(database.db, events.map(toRow)),
  log: () => {},
  now: () => new Date(),
  newKey: () => randomUUID(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  retryDelaysMs: [200],
});
writer.start();
for (let i = 0; i < Number(count); i += 1) {
  const channel = `50000000000000000${i % 2}`;
  writer.record(eventFromTransition("900000000000000001", "100000000000000001", "join", null, channel, new Date())!);
}
console.log(`pronto ${queue.size}`);
setInterval(() => {}, 1_000);
