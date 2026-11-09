// Carregado com `--import` só pelo `index.test.ts`, antes do `index.ts` real. Não faz parte do bot.
// - aponta o REST do discord.js para o Discord falso local (FAKE_DISCORD_PORT) e bloqueia
//   qualquer outro host, para o teste nunca sair da máquina;
// - tira a espera de 5 s entre identificações, que deixaria o teste lento;
// - recebe comandos do teste pelo canal IPC: emitir SIGINT (o Ctrl+C real não é automatizável
//   no Windows) e emitir o evento `error` do cliente (o gateway não tem como provocá-lo).
import dns from "node:dns";
import { createRequire } from "node:module";

const port = process.env.FAKE_DISCORD_PORT;
if (!port) throw new Error("FAKE_DISCORD_PORT ausente: este preload é só para o teste.");

// discord.js é CommonJS: o `require` daqui devolve os mesmos módulos que o `index.ts` importa.
const requireFromBot = createRequire(import.meta.url);
const discordPath = requireFromBot.resolve("discord.js");
const requireFromDiscord = createRequire(discordPath);
const discord = requireFromBot("discord.js");
const rest = requireFromDiscord("@discordjs/rest");
const ws = requireFromDiscord("@discordjs/ws");

rest.DefaultRestOptions.api = `http://127.0.0.1:${port}/api`;
rest.DefaultRestOptions.retries = 0;
ws.SimpleIdentifyThrottler.prototype.waitForIdentify = async () => {};

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;
const originalLookup = dns.lookup;
(dns as { lookup: unknown }).lookup = (hostname: string, options: unknown, callback?: LookupCallback) => {
  const cb = (typeof options === "function" ? options : callback) as LookupCallback;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return (originalLookup as (...args: unknown[]) => void).call(dns, hostname, options, callback);
  }
  const error = Object.assign(new Error(`teste: rede externa bloqueada (${hostname})`), { code: "ENOTFOUND" });
  process.nextTick(cb, error);
};

let client: { emit(event: string, ...args: unknown[]): boolean } | null = null;
const originalLogin = discord.Client.prototype.login;
discord.Client.prototype.login = function (this: typeof client, ...args: unknown[]) {
  client = this;
  return originalLogin.apply(this, args);
};

process.on("message", (command: unknown) => {
  if (command === "sigint") process.emit("SIGINT", "SIGINT");
  if (command === "client-error") {
    const error = new Error("SEGREDO-NA-MENSAGEM-DO-ERRO");
    error.name = "FakeClientError";
    client?.emit("error", error);
  }
});
// O canal IPC não deve, sozinho, manter o bot vivo.
process.channel?.unref();
