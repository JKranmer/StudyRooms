// Roda o `index.ts` real, como processo filho, contra um Discord falso local (REST + gateway).
// Token falso, sem `.env` e sem rede externa: o preload bloqueia qualquer host fora de 127.0.0.1.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

const BOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const PRELOAD = new URL("./index.test-preload.ts", import.meta.url).href;
const FAKE_TOKEN = "FAKE-TOKEN-SO-PARA-TESTE";
const ME = "111";
const OTHER = "222";
const GUILD = "900";
const CHANNELS: Record<string, string> = { "501": "Sala 1", "502": "Sala 2" };
const WAIT_MS = 10_000;

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

class FakeDiscord {
  port = 0;
  intents: number | null = null;
  identifies = 0;
  resumes = 0;
  closeOnIdentify: number | null = null;
  readonly voice = new Map<string, string>();
  #http: Server | null = null;
  #wss: { clients: Set<Socket>; close(): void; on(e: string, l: (ws: Socket) => void): void } | null = null;
  #ws: Socket | null = null;
  #session: Session | null = null;

  async start(): Promise<void> {
    this.#http = createServer((req, res) => {
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
    ws.on("error", () => {});
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

const children = new Set<ChildProcess>();
// Garantia extra: se o runner sair por qualquer caminho, nenhum bot fica vivo.
process.on("exit", () => {
  for (const child of children) child.kill();
});

class BotProcess {
  readonly lines: { stream: "out" | "err"; text: string }[] = [];
  readonly exited: Promise<number | null>;
  readonly #child: ChildProcess;
  #cursor = 0;
  #waiters = new Set<() => void>();

  constructor(fake: FakeDiscord) {
    this.#child = spawn(process.execPath, ["--import", PRELOAD, "src/index.ts"], {
      cwd: BOT_DIR,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        DISCORD_BOT_TOKEN: FAKE_TOKEN,
        BOT_TEST_ALLOWLIST_USER_IDS: ME,
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

  send(command: "sigint" | "client-error"): void {
    this.#child.send(command);
  }

  /** Ctrl+C: sinal real fora do Windows; no Windows, o preload emite SIGINT dentro do processo. */
  interrupt(): void {
    if (process.platform === "win32") this.send("sigint");
    else this.#child.kill("SIGINT");
  }

  async kill(): Promise<void> {
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill();
      await this.exited;
    }
  }
}

/** Sobe o Discord falso e o bot e garante que os dois são encerrados, passe ou falhe o teste. */
async function withBot(setup: (fake: FakeDiscord) => void, body: (bot: BotProcess, fake: FakeDiscord) => Promise<void>) {
  const fake = new FakeDiscord();
  await fake.start();
  setup(fake);
  const bot = new BotProcess(fake);
  try {
    await body(bot, fake);
    assert.ok(!bot.output.includes(FAKE_TOKEN), "o token apareceu na saída");
  } finally {
    await bot.kill();
    await fake.stop();
  }
}

after(() => {
  for (const child of children) child.kill();
});

describe("index.ts contra o Discord falso", { concurrency: true, timeout: 30_000 }, () => {
  test("pede as intents Guilds e GuildVoiceStates e lê quem já estava em call", () =>
    withBot(
      (fake) => {
        fake.setVoice(ME, "501");
        fake.setVoice(OTHER, "501");
      },
      async (bot, fake) => {
        await bot.waitFor(/^\[bot\] conectado como "bot-falso"; servidores: 1\.$/);
        assert.equal(fake.intents, 1 | 128, "intents enviadas no IDENTIFY");
        await bot.waitFor(/ já estava canal="Sala 1" id=501 usuario=111$/);
        await bot.waitFor(/^\[bot\] estado inicial: 1 da allowlist em call\.$/);
        fake.emitVoice(ME, "502");
        await bot.waitFor(/ trocou de="Sala 1" de_id=501 para="Sala 2" para_id=502 usuario=111$/);
        assert.ok(!bot.output.includes(OTHER), "quem não está na allowlist apareceu");
      },
    ));

  test("erro do cliente imprime só o nome", () =>
    withBot(
      () => {},
      async (bot) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        bot.send("client-error");
        await bot.waitFor(/^\[bot\] erro do cliente: FakeClientError$/);
        bot.interrupt();
        await bot.waitExit();
        assert.ok(!bot.output.includes("SEGREDO-NA-MENSAGEM-DO-ERRO"), `a mensagem do erro vazou:\n${bot.output}`);
        assert.ok(!/\bat \S+:\d+/.test(bot.output), `a pilha do erro vazou:\n${bot.output}`);
      },
    ));

  test("Ctrl+C encerra com código 0 e sem linha falsa de queda", () =>
    withBot(
      (fake) => fake.setVoice(ME, "501"),
      async (bot) => {
        await bot.waitFor(/estado inicial: 1 da allowlist/);
        const before = bot.lines.length;
        bot.interrupt();
        assert.equal(await bot.waitExit(), 0);
        const afterStop = bot.lines.slice(before).map((line) => line.text);
        assert.deepEqual(afterStop, [], "o encerramento não deve logar nada");
      },
    ));

  test("queda com resume: o evento perdido chega e a retomada é logada", () =>
    withBot(
      (fake) => fake.setVoice(ME, "501"),
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 1 da allowlist/);
        fake.cut();
        fake.emitVoice(ME, null);
        await bot.waitFor(/ queda detectada; reconectando/);
        await bot.waitFor(/ saiu canal="Sala 1" id=501 usuario=111 horario=chegada$/);
        await bot.waitFor(/ retomada modo=resume reenviados=\d+ tentativas=\d+ desde_deteccao_s=\d+$/);
        assert.equal(fake.identifies, 1, "resume não deve identificar de novo");
      },
    ));

  test("queda com nova sessão: o GUILD_CREATE reconcilia quem trocou de canal", () =>
    withBot(
      (fake) => fake.setVoice(ME, "501"),
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 1 da allowlist/);
        fake.setVoice(ME, "502");
        fake.cut({ invalidate: true });
        await bot.waitFor(/ queda detectada; reconectando/);
        await bot.waitFor(/ trocou_na_queda de="Sala 1" de_id=501 para="Sala 2" para_id=502 usuario=111 horario=deteccao$/);
        await bot.waitFor(/ retomada modo=identify /);
        assert.equal(fake.identifies, 2);
      },
    ));

  test("código 4004 (sem reconexão) encerra o bot com código 1", () =>
    withBot(
      () => {},
      async (bot, fake) => {
        await bot.waitFor(/estado inicial: 0 da allowlist/);
        fake.closeOnIdentify = 4004;
        fake.cut({ invalidate: true });
        await bot.waitFor(/encerrou a conexão sem permitir reconexão \(código: 4004\)/);
        assert.equal(await bot.waitExit(), 1);
      },
    ));
});
