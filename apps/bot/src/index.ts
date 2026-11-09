import {
  Client,
  Events,
  GatewayIntentBits,
  OAuth2Scopes,
  PermissionFlagsBits,
  type Guild,
} from "discord.js";
import { createBotHandlers, type GuildView } from "./bot-handlers.ts";
import { loadConfig } from "./config.ts";
import { quoteForLog } from "./voice-event.ts";

const config = loadConfig(process.env);
if (!config.ok) {
  console.error(`[bot] erro: ${config.error}`);
  process.exit(1);
}

// Só com GuildVoiceStates não chega GUILD_CREATE: o cache de canais fica vazio, sem nome de
// canal e sem o estado de voz inicial. Nenhuma das duas intents é privilegiada, e o bot não lê mensagens.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const handlers = createBotHandlers({
  allowlist: config.allowlist,
  log: (line) => console.log(line),
  now: () => new Date(),
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

client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
  handlers.onVoiceState(guildView(newState.guild), newState.id, newState.channelId);
});

client.once(Events.ClientReady, (ready) => {
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

client.on(Events.GuildAvailable, (guild) => handlers.onGuildAvailable(guildView(guild)));
client.on(Events.GuildCreate, (guild) => handlers.onGuildAvailable(guildView(guild)));

client.on(Events.ShardReconnecting, () => handlers.onReconnecting());
client.on(Events.ShardResume, (_shardId, replayed) => handlers.onResume(replayed));
client.on(Events.ShardReady, () => handlers.onShardReady());
client.on(Events.ShardError, (error) => handlers.onShardError(error));

// Só os códigos sem reconexão chegam aqui (token revogado, intent recusada): o bot ficaria
// ligado e surdo, então é melhor encerrar com erro e deixar quem o supervisiona ver a falha.
client.on(Events.ShardDisconnect, (event) => {
  handlers.onDisconnect(event.code);
  shutdown(1);
});

client.on(Events.Error, (error) => {
  console.error(`[bot] erro do cliente: ${error.name}`);
});

function shutdown(exitCode = 0): void {
  handlers.stop();
  void client.destroy().finally(() => process.exit(exitCode));
}
process.once("SIGINT", () => shutdown());
process.once("SIGTERM", () => shutdown());

// Só o código do erro é impresso, para nada sensível chegar ao console. Aqui não se usa
// process.exit: logo após a falha do login, ele aborta o Node no Windows (assert da libuv).
client.login(config.token).catch(async (error: { code?: unknown; name?: unknown }) => {
  const code = String(error.code ?? error.name ?? "desconhecido");
  console.error(
    code === "TokenInvalid"
      ? "[bot] erro: DISCORD_BOT_TOKEN inválido: o Discord recusou o login. Gere outro token no portal."
      : `[bot] erro: não foi possível conectar ao Discord (código: ${code}).`,
  );
  process.exitCode = 1;
  handlers.stop();
  await client.destroy();
});
