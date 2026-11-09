export type VoiceEventType = "join" | "leave" | "move" | "seen" | "ignore";

export type ClassifyInput = {
  userId: string;
  allowlist: ReadonlySet<string>;
  /** `undefined`: não se sabe onde a pessoa estava antes; `null`: ela não estava em canal. */
  oldChannelId: string | null | undefined;
  newChannelId: string | null;
};

export function classifyVoiceEvent(input: ClassifyInput): VoiceEventType {
  const { userId, allowlist, oldChannelId, newChannelId } = input;
  if (!allowlist.has(userId)) return "ignore";
  if (oldChannelId === undefined) return newChannelId === null ? "ignore" : "seen";
  if (oldChannelId === newChannelId) return "ignore";
  if (oldChannelId === null) return "join";
  if (newChannelId === null) return "leave";
  return "move";
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  const ids = (raw ?? "").split(",").map((id) => id.trim());
  return new Set(ids.filter((id) => id !== ""));
}

export type ChannelRef = { id: string; name: string | null };

type LogContext = {
  at: Date;
  userId?: string;
  /** O evento chegou durante a reconexão: o horário é o de chegada, não o do fato. */
  arrival?: boolean;
};

type EnteredType = "join" | "already" | "still" | "seen" | "joined_gap";
type MovedType = "move" | "moved_gap";

export type VoiceLogEntry = LogContext &
  (
    | { type: EnteredType; newChannel: ChannelRef }
    | { type: "leave" | "left_gap"; oldChannel: ChannelRef }
    | { type: MovedType; oldChannel: ChannelRef; newChannel: ChannelRef }
  );

// O JSON não escapa separadores de linha Unicode, C1 (como CSI) nem controles bidirecionais, que
// quebram ou disfarçam a linha no terminal. O ZWJ fica de fora: é inofensivo e compõe emoji.
const UNSAFE_IN_LOG = /[[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]--[‍]]/gv;

function escapeCodeUnits(text: string): string {
  let escaped = "";
  for (let i = 0; i < text.length; i += 1) {
    escaped += `\\u${text.charCodeAt(i).toString(16).padStart(4, "0")}`;
  }
  return escaped;
}

/** Devolve o texto entre aspas, em uma linha só e ainda como JSON válido. */
export function quoteForLog(text: string | null): string {
  return JSON.stringify(text).replace(UNSAFE_IN_LOG, escapeCodeUnits);
}

function describe(entry: VoiceLogEntry): string {
  switch (entry.type) {
    case "join":
      return `entrou ${channelField(entry.newChannel)}`;
    case "already":
      return `já estava ${channelField(entry.newChannel)}`;
    case "still":
      return `continua ${channelField(entry.newChannel)}`;
    case "seen":
      return `visto ${channelField(entry.newChannel)}`;
    case "joined_gap":
      return `entrou_na_queda ${channelField(entry.newChannel)}`;
    case "leave":
      return `saiu ${channelField(entry.oldChannel)}`;
    case "left_gap":
      return `saiu_na_queda ${channelField(entry.oldChannel)}`;
    case "move":
      return `trocou ${moveFields(entry.oldChannel, entry.newChannel)}`;
    case "moved_gap":
      return `trocou_na_queda ${moveFields(entry.oldChannel, entry.newChannel)}`;
  }
}

function channelField(channel: ChannelRef): string {
  return `canal=${quoteForLog(channel.name)} id=${channel.id}`;
}

function moveFields(from: ChannelRef, to: ChannelRef): string {
  return `de=${quoteForLog(from.name)} de_id=${from.id} para=${quoteForLog(to.name)} para_id=${to.id}`;
}

function suffix(entry: VoiceLogEntry): string {
  let text = entry.userId ? ` usuario=${entry.userId}` : "";
  if (entry.type === "seen") text += " estado_anterior=desconhecido";
  if (entry.type === "joined_gap" || entry.type === "left_gap" || entry.type === "moved_gap") {
    text += " horario=deteccao";
  }
  if (entry.arrival) text += " horario=chegada";
  return text;
}

export function formatVoiceLogLine(entry: VoiceLogEntry): string {
  return `${entry.at.toISOString()} ${describe(entry)}${suffix(entry)}`;
}
