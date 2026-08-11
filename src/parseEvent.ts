// Real shape, confirmed from a captured live event:
//   {"events":[{"event":"CustomCommand","origin":"<robloxUserId>","timestamp":N,
//               "data":{"command":"verify","argument":"ABC123"}}], "server":"..."}
// ER:LC pre-parses ";"-prefixed chat into command/argument itself (no raw message text to
// split), batches multiple events per POST, and identifies the sender by numeric Roblox user
// ID — not username. A second confirmed shape is the periodic validation probe:
//   {"events":[{"event":"WebhookProbe","origin":"global","timestamp":N,"data":{}}],"server":"..."}

export interface ChatEvent {
  kind: "chat";
  robloxUserId: string;
  command: string;
  argument: string;
  raw: unknown;
}

export interface ProbeEvent {
  kind: "probe";
  raw: unknown;
}

export interface UnknownEvent {
  kind: "unknown";
  raw: unknown;
}

export type ParsedEvent = ChatEvent | ProbeEvent | UnknownEvent;

interface RawInnerEvent {
  event?: string;
  origin?: string;
  data?: { command?: string; argument?: string };
}

export function parseIncomingEvents(body: unknown): ParsedEvent[] {
  if (typeof body !== "object" || body === null) return [{ kind: "unknown", raw: body }];

  const obj = body as Record<string, unknown>;
  if (!Array.isArray(obj.events)) return [{ kind: "unknown", raw: body }];

  return (obj.events as RawInnerEvent[]).map((e): ParsedEvent => {
    if (e.event === "WebhookProbe") return { kind: "probe", raw: e };

    if (e.event === "CustomCommand" && typeof e.origin === "string" && e.data?.command) {
      return {
        kind: "chat",
        robloxUserId: e.origin,
        command: e.data.command.toLowerCase(),
        argument: e.data.argument ?? "",
        raw: e,
      };
    }

    return { kind: "unknown", raw: e };
  });
}
