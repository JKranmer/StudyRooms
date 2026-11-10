import {
  Client,
  Events,
  GatewayIntentBits,
  OAuth2Scopes,
  PermissionFlagsBits,
  type Guild,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { createDb, findErrorCode, insertRawVoiceEvents } from "@studyrooms/db";
import { createBotHandlers, type GuildView } from "./bot-handlers.ts";
import { loadConfig } from "./config.ts";
import { DiskQueue, type OpenResult } from "./event-queue.ts";
import { createEventWriter } from "./event-writer.ts";
import { createLoginLoop, EXIT_CONFIG, gatewayCloseExitCode, queueOpenExitCode } from "./login-retry.ts";
import { toRow } from "./raw-event.ts";
import { createShutdown } from "./shutdown.ts";
import { quoteForLog } from "./voice-event.ts";

// Códigos de saída (veja login-retry.ts): 0 no encerramento pedido; 78 para erro de configuração,
// que o systemd da VM não reinicia; 1 para as demais falhas, que ele reinicia.
const config = loadConfig(process.env);
if (!config.ok) {
  console.error(`[bot] erro: ${config.error}`);
  process.exit(EXIT_CONFIG);
}
for (const warning of config.warnings) console.warn(`[bot] aviso: ${warning}`);

// A fila em disco guarda cada evento antes de ir ao banco: com o banco fora ou o processo morto,
// nada se perde. No container (read_only), a pasta é um volume (veja compose.yaml).
let opened: OpenResult;
try {
  opened = DiskQueue.open(config.queueDir);
} catch (error) {
  const code = findErrorCode(error);
  console.error(
    `[fila] erro: não foi possível abrir a fila em disco (código: ${code ?? "desconhecido"}). Confira BOT_QUEUE_DIR.`,
  );
  process.exit(queueOpenExitCode(code));
}
if (opened.loaded > 0) console.log(`[fila] ${opened.loaded} evento(s) pendente(s) de uma execução anterior.`);
if (opened.damaged > 0 && opened.quarantineError === null) {
  console.warn(`[fila] aviso: ${opened.damaged} linha(s) ilegível(is) separada(s) na quarentena.`);
} else if (opened.damaged > 0) {
  // Disco cheio não impede a subida: as linhas ficam na fila até caberem na quarentena.
  console.warn(
    `[fila] aviso: ${opened.damaged} linha(s) ilegível(is) mantida(s) na fila; a quarentena falhou (código: ${opened.quarantineError}). Libere espaço em disco.`,
  );
}

let stopping = false;
// Uma conexão só, fechada depois de 5 s ociosa: conexão aberta à toa impede o Neon de suspender.
// Os prazos evitam que um banco que não responde prenda a fila.
const database = createDb(config.databaseUrl, {
  pool: { max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000, queryTimeoutMillis: 15_000 },
  onPoolError: (code) => {
    if (!stopping) console.warn(`[db] aviso: conexão ociosa encerrada pelo banco (código: ${code ?? "desconhecido"}).`);
  },
});
const writer = createEventWriter({
  queue: opened.queue,
  insert: (events) => insertRawVoiceEvents(database.db, events.map(toRow)),
  log: (line) => console.log(line),
  now: () => new Date(),
  newKey: () => randomUUID(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
});
writer.start();

/** Última tentativa de gravar a fila; o que não couber no prazo do encerramento fica no disco. */
async function closeStorage(): Promise<void> {
  stopping = true;
  try {
    await writer.close();
  } finally {
    await database.close().catch(() => {});
  }
}

const handlers = createBotHandlers({
  allowlist: config.allowlist,
  log: (line) => console.log(line),
  now: () => new Date(),
  record: (event) => writer.record(event),
});

function guildView(guild: Guild): GuildView {
  return {
    id: guild.id,
    available: guild.available,
    channelName: (channelId) => guild.channels.cache.get(channelId)?.name ?? null,
    voiceStates: () =>
      guild.voiceStates.cache.map((state) => ({ userId: state.id, channelId: state.channelId })),
  };
}

/**
 * Um cliente novo por tentativa de login: depois de um login que falhou, o discord.js destrói o
 * cliente, e o gerenciador de WebSocket dele fica marcado como destruído, sem reconectar mais.
 */
function createClient(): Client {
  // Só com GuildVoiceStates não chega GUILD_CREATE: o cache de canais fica vazio, sem nome de
  // canal e sem o estado de voz inicial. Nenhuma das duas intents é privilegiada, e o bot não lê mensagens.
  const created = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  created.on(Events.VoiceStateUpdate, (_oldState, newState) => {
    handlers.onVoiceState(guildView(newState.guild), newState.id, newState.channelId);
  });

  created.once(Events.ClientReady, (ready) => {
    console.log(`[bot] conectado como ${quoteForLog(ready.user.tag)}; servidores: ${ready.guilds.cache.size}.`);
    if (ready.guilds.cache.size === 0) {
      const invite = ready.generateInvite({
        scopes: [OAuth2Scopes.Bot],
        permissions: [PermissionFlagsBits.ViewChannel],
      });
      console.log(`[bot] aviso: o bot não está em nenhum servidor. Convite: ${invite}`);
    }
    handlers.onClientReady(ready.guilds.cache.map(guildView));
  });

  created.on(Events.GuildAvailable, (guild) => handlers.onGuildAvailable(guildView(guild)));
  created.on(Events.GuildCreate, (guild) => handlers.onGuildAvailable(guildView(guild)));

  created.on(Events.ShardReconnecting, () => handlers.onReconnecting());
  created.on(Events.ShardResume, (_shardId, replayed) => handlers.onResume(replayed));
  created.on(Events.ShardReady, () => handlers.onShardReady());
  created.on(Events.ShardError, (error) => handlers.onShardError(error));

  // Só os códigos sem reconexão chegam aqui: o bot ficaria ligado e surdo, então é melhor encerrar
  // com erro e deixar quem o supervisiona ver a falha. Token revogado (4004) e intent recusada
  // (4013, 4014) saem com o código de configuração, para o systemd não reiniciar em laço.
  created.on(Events.ShardDisconnect, (event) => {
    handlers.onDisconnect(event.code);
    shutdown(gatewayCloseExitCode(event.code));
  });

  created.on(Events.Error, (error) => {
    console.error(`[bot] erro do cliente: ${error.name}`);
  });
  return created;
}

let client = createClient();

const loginLoop = createLoginLoop({
  attempt: async (n) => {
    if (n > 1) {
      client.removeAllListeners();
      client = createClient();
    }
    await client.login(config.token);
  },
  log: (line) => {
    if (line.startsWith("[bot] erro")) console.error(line);
    else if (line.startsWith("[bot] aviso")) console.warn(line);
    else console.log(line);
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
});

// Com login ou reconexão pendentes (Hello ou READY sem chegar), `client.destroy()` não resolve:
// por isso há um prazo, menor que os 10 s do `docker stop`. No container, o Node pode ser o PID 1,
// que não tem tratamento padrão de sinal: sem estes handlers, o SIGTERM seria ignorado.
const shutdown = createShutdown({
  graceMs: 3_000,
  stop: () => {
    loginLoop.cancel();
    handlers.stop();
  },
  destroy: () => Promise.all([client.destroy(), closeStorage()]),
  exit: (code) => process.exit(code),
  setTimer: (fn, ms) => setTimeout(fn, ms),
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Erro de rede no login é tentado de novo dentro do processo (login-retry.ts); só o código do
// erro é impresso, para nada sensível chegar ao console. Aqui não se usa process.exit: logo após a
// falha do login, ele aborta o Node no Windows (assert da libuv).
void loginLoop.run().then(async (outcome) => {
  if (outcome.status !== "failed") return;
  process.exitCode = outcome.exitCode;
  handlers.stop();
  await Promise.all([client.destroy(), closeStorage()]);
});
