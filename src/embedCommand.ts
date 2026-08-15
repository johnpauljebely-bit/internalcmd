import type { Message } from "discord.js";
import { EMBED_ADMIN_ROLE_IDS } from "./config.js";
import { containerMessage } from "./ui.js";

const PREFIX = "!embed ";

// Deliberately trusts the raw JSON verbatim (no schema validation beyond "does it parse") — the
// whole point is letting Directive/Executive-tier staff send arbitrary Components V2 payloads,
// not a narrow builder. Malformed JSON or a payload Discord itself rejects both get reported back
// to the sender rather than failing silently.
export async function handleEmbedCommand(message: Message): Promise<void> {
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.member?.roles.cache.some((r) => EMBED_ADMIN_ROLE_IDS.includes(r.id))) return;

  const raw = message.content.slice(PREFIX.length).trim();
  if (!raw) return;
  if (!message.channel.isSendable()) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[embed] invalid JSON from ${message.author.id}`, err);
    await message.reply(containerMessage("That's not valid JSON — couldn't parse it.")).catch(() => {});
    return;
  }

  try {
    await message.channel.send(parsed as never);
  } catch (err) {
    console.error(`[embed] Discord rejected the payload from ${message.author.id}`, err);
    await message.reply(containerMessage("Discord rejected that payload — check the JSON structure.")).catch(() => {});
  }
}
