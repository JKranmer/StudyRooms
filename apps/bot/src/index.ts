import {
  Client,
  Events,
  GatewayIntentBits,
  OAuth2Scopes,
  PermissionFlagsBits,
  type VoiceState,
} from "discord.js";
import {
  classifyVoiceEvent,
  formatVoiceLogLine,
  parseAllowlist,
  type ChannelRef,
} from "./voice-event.ts";

function fail(message: string): never {
  console.error(`[bot] erro: ${message}`);
  process.exit(1);
}

const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!token) {
  fail("DISCORD_BOT_TOKEN não definido. Preencha o .env na raiz do projeto (veja .env.example).");
}

// Sem allowlist, nada seria logado: falhar é mais claro do que ficar mudo.
const allowlist = parseAllowlist(process.env.BOT_TEST_ALLOWLIST_USER_IDS);
if (allowlist.size === 0) {
  fail("BOT_TEST_ALLOWLIST_USER_IDS vazio. Informe ao menos um ID de usuário (veja .env.example).");
}

// Só com GuildVoiceStates não chega GUILD_CREATE: o cache de canais fica vazio, sem nome de
// canal e sem o estado de voz inicial. Nenhuma das duas intents é privilegiada, e o bot não lê mensagens.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

function channelRef(state: VoiceState, id: string): ChannelRef {
  return { id, name: state.channel?.name ?? null };
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const oldId = oldState.channelId;
  const newId = newState.channelId;
  const type = classifyVoiceEvent({
    userId: newState.id,
    allowlist,
    oldChannelId: oldId,
    newChannelId: newId,
  });
  const at = new Date();

  if (type === "join" && newId) {
    console.log(formatVoiceLogLine({ type, at, newChannel: channelRef(newState, newId) }));
  } else if (type === "leave" && oldId) {
    console.log(formatVoiceLogLine({ type, at, oldChannel: channelRef(oldState, oldId) }));
  } else if (type === "move" && oldId && newId) {
    console.log(
      formatVoiceLogLine({
        type,
        at,
        oldChannel: channelRef(oldState, oldId),
        newChannel: channelRef(newState, newId),
      }),
    );
  }
});

client.once(Events.ClientReady, (ready) => {
  console.log(`[bot] conectado como ${ready.user.tag}; servidores: ${ready.guilds.cache.size}.`);
  if (ready.guilds.cache.size === 0) {
    const invite = ready.generateInvite({
      scopes: [OAuth2Scopes.Bot],
      permissions: [PermissionFlagsBits.ViewChannel],
    });
    console.log(`[bot] aviso: o bot não está em nenhum servidor. Convite: ${invite}`);
  }
});

client.on(Events.Error, (error) => {
  console.error(`[bot] erro do cliente: ${error.name}`);
});

function shutdown(): void {
  void client.destroy().finally(() => process.exit(0));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// Só o código do erro é impresso, para nada sensível chegar ao console. Aqui não se usa
// process.exit: logo após a falha do login, ele aborta o Node no Windows (assert da libuv).
client.login(token).catch(async (error: { code?: unknown; name?: unknown }) => {
  const code = String(error.code ?? error.name ?? "desconhecido");
  console.error(
    code === "TokenInvalid"
      ? "[bot] erro: DISCORD_BOT_TOKEN inválido: o Discord recusou o login. Gere outro token no portal."
      : `[bot] erro: não foi possível conectar ao Discord (código: ${code}).`,
  );
  process.exitCode = 1;
  await client.destroy();
});
