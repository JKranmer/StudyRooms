export type VoiceEventType = "join" | "leave" | "move" | "ignore";

export type ClassifyInput = {
  userId: string;
  allowlist: ReadonlySet<string>;
  oldChannelId: string | null;
  newChannelId: string | null;
};

export function classifyVoiceEvent(input: ClassifyInput): VoiceEventType {
  const { userId, allowlist, oldChannelId, newChannelId } = input;
  if (!allowlist.has(userId)) return "ignore";
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

export type VoiceLogEntry =
  | { type: "join"; at: Date; newChannel: ChannelRef }
  | { type: "leave"; at: Date; oldChannel: ChannelRef }
  | { type: "move"; at: Date; oldChannel: ChannelRef; newChannel: ChannelRef };

const quoted = (name: string | null) => JSON.stringify(name);

export function formatVoiceLogLine(entry: VoiceLogEntry): string {
  const time = entry.at.toISOString();
  switch (entry.type) {
    case "join":
      return `${time} entrou canal=${quoted(entry.newChannel.name)} id=${entry.newChannel.id}`;
    case "leave":
      return `${time} saiu canal=${quoted(entry.oldChannel.name)} id=${entry.oldChannel.id}`;
    case "move":
      return (
        `${time} trocou de=${quoted(entry.oldChannel.name)} de_id=${entry.oldChannel.id}` +
        ` para=${quoted(entry.newChannel.name)} para_id=${entry.newChannel.id}`
      );
  }
}
