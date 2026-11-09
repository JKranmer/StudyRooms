// Apoio aos testes que rodam o `index.ts` real como processo filho, contra um Discord falso local
// (REST + gateway). Token falso, sem `.env` e sem rede externa: o preload bloqueia qualquer host
// fora de 127.0.0.1. Não faz parte do bot (o Dockerfile deixa `*.test-helper.ts` fora da imagem).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Socket as TcpSocket } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const BOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const PRELOAD = new URL("./index.test-preload.ts", import.meta.url).href;
export const FAKE_TOKEN = "FAKE-TOKEN-SO-PARA-TESTE";
// Snowflakes válidos: o teste com Postgres real grava estes IDs, e o banco recusa outros formatos.
export const ME = "100000000000000111";
export const OTHER = "100000000000000222";
export const GUILD = "900000000000000900";
export const SALA_1 = "500000000000000501";
export const SALA_2 = "500000000000000502";
const CHANNELS: Record<string, string> = { [SALA_1]: "Sala 1", [SALA_2]: "Sala 2" };
// Folga para máquinas carregadas: cada bot leva cerca de 3 s de CPU só para carregar discord.js e o Drizzle.
export const WAIT_MS = 20_000;

// `ws` vem junto com o discord.js; não é dependência direta do bot.
const requireFromDiscord = createRequire(createRequire(import.meta.url).resolve("discord.js"));
const { WebSocketServer } = createRequire(requireFromDiscord.resolve("@discordjs/ws"))("ws");

type Socket = {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  terminate(): void;
  on(event: string, listener: (data: Buffer) => void): void;
};
type Session = { id: string; seq: number; buffer: object[] };

export class FakeDiscord {
  port = 0;
  intents: number | null = null;
  identifies = 0;
  resumes = 0;
  closeOnIdentify: number | null = null;
  /** Para simular login ou reconexão pendentes: REST sem resposta, gateway sem Hello ou sem READY. */
  hangRest = false;
  withholdHello = false;
  withholdReady = false;
  restRequests = 0;
  connections = 0;
  readonly voice = new Map<string, string>();
  #http: Server | null = null;
  #wss: { clients: Set<Socket>; close(): void; on(e: string, l: (ws: Socket) => void): void } | null = null;
  #ws: Socket | null = null;
  #session: Session | null = null;

  async start(): Promise<void> {
    this.#http = createServer((req, res) => {
      this.restRequests += 1;
      if (this.hangRest) return;
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/gateway/bot")) {
        res.end(
          JSON.stringify({
            url: `ws://127.0.0.1:${this.port}`,
            shards: 1,
            session_start_limit: { total: 1000, remaining: 999, reset_after: 1000, max_concurrency: 1 },
          }),
        );
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    this.#wss = new WebSocketServer({ server: this.#http });
    this.#wss!.on("connection", (ws) => this.#onConnection(ws));
    this.#http.listen(0, "127.0.0.1");
    await once(this.#http, "listening");
    this.port = (this.#http.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const ws of this.#wss?.clients ?? []) ws.terminate();
    this.#wss?.close();
    this.#http?.closeAllConnections();
    await new Promise((resolve) => (this.#http ? this.#http.close(resolve) : resolve(undefined)));
  }

  #onConnection(ws: Socket): void {
    this.#ws = ws;
    this.connections += 1;
    ws.on("error", () => {});
    if (this.withholdHello) return;
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }));
    ws.on("message", (raw) => {
      if (ws !== this.#ws) return;
      const message = JSON.parse(raw.toString()) as { op: number; d: Record<string, unknown> };
      if (message.op === 1) ws.send(JSON.stringify({ op: 11 }));
      else if (message.op === 2) this.#identify(ws, message.d);
      else if (message.op === 6) this.#resume(ws, message.d);
    });
  }

  #identify(ws: Socket, d: Record<string, unknown>): void {
    this.identifies += 1;
    this.intents = d.intents as number;
    if (this.closeOnIdentify) return ws.close(this.closeOnIdentify);
    if (this.withholdReady) return;
    this.#session = { id: `s${this.identifies}`, seq: 0, buffer: [] };
    this.#dispatch("READY", {
      v: 10,
      user: { id: "999", username: "bot-falso", discriminator: "0", bot: true },
      guilds: [{ id: GUILD, unavailable: true }],
      session_id: this.#session.id,
      resume_gateway_url: `ws://127.0.0.1:${this.port}`,
      application: { id: "999", flags: 0 },
    });
    this.#dispatch("GUILD_CREATE", {
      id: GUILD,
      name: "Servidor falso",
      unavailable: false,
      owner_id: "1",
      channels: Object.entries(CHANNELS).map(([id, name]) => ({ id, name, type: 2 })),
      roles: [],
      emojis: [],
      stickers: [],
      members: [],
      threads: [],
      presences: [],
      stage_instances: [],
      guild_scheduled_events: [],
      soundboard_sounds: [],
      features: [],
      voice_states: [...this.voice].map(([userId, channelId]) => voiceState(userId, channelId)),
      member_count: 3,
      large: false,
      joined_at: new Date(0).toISOString(),
    });
  }

  #resume(ws: Socket, d: Record<string, unknown>): void {
    this.resumes += 1;
    if (!this.#session || this.#session.id !== d.session_id) {
      ws.send(JSON.stringify({ op: 9, d: false }));
      return;
    }
    for (const packet of this.#session.buffer as { s: number }[]) {
      if (packet.s > (d.seq as number)) ws.send(JSON.stringify({ op: 0, ...packet }));
    }
    this.#dispatch("RESUMED", {});
  }

  #dispatch(t: string, d: object): void {
    if (!this.#session) return;
    const packet = { t, s: ++this.#session.seq, d };
    this.#session.buffer.push(packet);
    if (this.#ws?.readyState === 1) this.#ws.send(JSON.stringify({ op: 0, ...packet }));
  }

  setVoice(userId: string, channelId: string | null): void {
    if (channelId) this.voice.set(userId, channelId);
    else this.voice.delete(userId);
  }

  /** Muda o estado e envia o VOICE_STATE_UPDATE (guardado para replay se o bot estiver fora). */
  emitVoice(userId: string, channelId: string | null): void {
    this.setVoice(userId, channelId);
    this.#dispatch("VOICE_STATE_UPDATE", { guild_id: GUILD, ...voiceState(userId, channelId) });
  }

  /** Derruba o TCP sem fechamento limpo; com `invalidate`, o resume é recusado. */
  cut({ invalidate = false } = {}): void {
    if (invalidate) this.#session = null;
    const ws = this.#ws;
    this.#ws = null;
    ws?.terminate();
  }
}

function voiceState(userId: string, channelId: string | null) {
  return {
    channel_id: channelId,
    user_id: userId,
    session_id: `vs-${userId}`,
    deaf: false,
    mute: false,
    self_deaf: false,
    self_mute: false,
    self_video: false,
    suppress: false,
  };
}

/** Espera uma condição do Discord falso (não há linha de log nesses momentos). */
export async function until(condition: () => boolean, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condição não atingida a tempo");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export const children = new Set<ChildProcess>();
// Garantia extra: se o runner sair por qualquer caminho, nenhum bot fica vivo.
process.on("exit", () => {
  for (const child of children) child.kill();
});

export type BotOptions = {
  envFile?: string;
  allowlist?: string;
  /** Conexão do banco. O padrão é um banco falso que derruba toda conexão na hora. */
  databaseUrl?: string;
  /** Pasta da fila em disco. O padrão é uma pasta temporária nova. */
  queueDir?: string;
};

export class BotProcess {
  readonly lines: { stream: "out" | "err"; text: string }[] = [];
  readonly exited: Promise<number | null>;
  readonly #child: ChildProcess;
  #cursor = 0;
  #waiters = new Set<() => void>();

  /** Com `envFile`, token e allowlist vêm desse arquivo, lido pelo `--env-file` do Node, como no `start`. */
  constructor(
    fake: FakeDiscord,
    { envFile, allowlist = ME, databaseUrl = refusingDatabaseUrl(), queueDir = tempQueueDir() }: BotOptions = {},
  ) {
    const args = envFile ? [`--env-file=${envFile}`] : [];
    const config = envFile
      ? {}
      : { DISCORD_BOT_TOKEN: FAKE_TOKEN, BOT_TEST_ALLOWLIST_USER_IDS: allowlist, BOT_DATABASE_URL: databaseUrl };
    this.#child = spawn(process.execPath, [...args, "--import", PRELOAD, "src/index.ts"], {
      cwd: BOT_DIR,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...config,
        BOT_QUEUE_DIR: queueDir,
        FAKE_DISCORD_PORT: String(fake.port),
      },
    });
    children.add(this.#child);
    this.exited = new Promise((resolve) => {
      this.#child.once("exit", (code) => {
        children.delete(this.#child);
        this.#notify();
        resolve(code);
      });
    });
    this.#read(this.#child.stdout!, "out");
    this.#read(this.#child.stderr!, "err");
  }

  #read(stream: NodeJS.ReadableStream, name: "out" | "err"): void {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      const parts = (pending + chunk).split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const text of parts) if (text.trim()) this.lines.push({ stream: name, text });
      this.#notify();
    });
  }

  #notify(): void {
    for (const waiter of this.#waiters) waiter();
  }

  get output(): string {
    return this.lines.map((line) => `[${line.stream}] ${line.text}`).join("\n");
  }

  /** Espera a próxima linha (depois da última encontrada) que casa com `pattern`. */
  async waitFor(pattern: RegExp, ms = WAIT_MS): Promise<string> {
    const deadline = Date.now() + ms;
    for (;;) {
      const index = this.lines.findIndex((line, i) => i >= this.#cursor && pattern.test(line.text));
      if (index >= 0) {
        this.#cursor = index + 1;
        return this.lines[index]!.text;
      }
      const left = deadline - Date.now();
      if (left <= 0 || this.#child.exitCode !== null) {
        throw new Error(`não apareceu ${pattern} (${this.#child.exitCode === null ? "timeout" : "processo encerrou"}). Saída:\n${this.output}`);
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.#waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, left);
        this.#waiters.add(done);
      });
    }
  }

  async waitExit(ms = WAIT_MS): Promise<number | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`o bot não encerrou em ${ms} ms. Saída:\n${this.output}`)), ms);
    });
    try {
      return await Promise.race([this.exited, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  send(command: "sigint" | "sigterm" | "client-error"): void {
    this.#child.send(command);
  }

  /** Ctrl+C: sinal real fora do Windows; no Windows, o preload emite SIGINT dentro do processo. */
  interrupt(): void {
    if (process.platform === "win32") this.send("sigint");
    else this.#child.kill("SIGINT");
  }

  /** `docker stop`: SIGTERM real fora do Windows; no Windows, emitido pelo preload. */
  terminate(): void {
    if (process.platform === "win32") this.send("sigterm");
    else this.#child.kill("SIGTERM");
  }

  /** Morte sem aviso (SIGKILL): o bot não tem chance de gravar nada nem de limpar a fila. */
  async forceKill(): Promise<void> {
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill("SIGKILL");
      await this.exited;
    }
  }

  async kill(): Promise<void> {
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill();
      await this.exited;
    }
  }
}

/** Sobe o Discord falso e o bot e garante que os dois são encerrados, passe ou falhe o teste. */
export async function withBot(
  setup: (fake: FakeDiscord) => void,
  body: (bot: BotProcess, fake: FakeDiscord) => Promise<void>,
  options: BotOptions = {},
) {
  const fake = new FakeDiscord();
  await fake.start();
  setup(fake);
  const bot = new BotProcess(fake, options);
  try {
    await body(bot, fake);
    assert.ok(!bot.output.includes(FAKE_TOKEN), "o token apareceu na saída");
  } finally {
    await bot.kill();
    await fake.stop();
  }
}

/** Pastas temporárias de fila criadas pelos testes, apagadas ao fim do processo de teste. */
const queueDirs = new Set<string>();
export function tempQueueDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bot-fila-"));
  queueDirs.add(dir);
  return dir;
}

/**
 * "Banco" que aceita a conexão TCP e a derruba na hora: a gravação falha rápido, como banco fora,
 * sem a espera de cerca de 2 s que o Windows tem ao recusar conexão em 127.0.0.1.
 */
let refusingPort = 0;
const refusingSockets = new Set<TcpSocket>();
const refusingServer = createTcpServer((socket) => {
  refusingSockets.add(socket);
  socket.destroy();
});
export async function startRefusingDatabase(): Promise<void> {
  if (refusingPort) return;
  refusingServer.listen(0, "127.0.0.1");
  await once(refusingServer, "listening");
  refusingPort = (refusingServer.address() as AddressInfo).port;
  refusingServer.unref();
}
export function refusingDatabaseUrl(): string {
  if (!refusingPort) throw new Error("chame startRefusingDatabase() antes");
  return `postgres://bot:senha-falsa@127.0.0.1:${refusingPort}/studyrooms`;
}

process.on("exit", () => {
  for (const dir of queueDirs) rmSync(dir, { recursive: true, force: true });
});
