import type { Message } from "discord.js";
import { getGuild } from "./discordBot.js";
import { MEDIA_RELAY_ROLE_ID, MEDIA_RELAY_CHANNEL_ID } from "./config.js";
import { buildMediaRelayEmbed } from "./sessionEmbeds.js";

// Any linked message.member check needs the guild's cached member, not just the author — bots
// only get full role data on messages from guilds they're actually in, which this always is.
export async function handleMediaRelayMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== "!media") return;
  if (!message.member?.roles.cache.has(MEDIA_RELAY_ROLE_ID)) return;

  const image = message.attachments.find((a) => (a.contentType ?? "").startsWith("image/"));
  if (!image) return;

  try {
    const guild = await getGuild();
    const channel = await guild.channels.fetch(MEDIA_RELAY_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isSendable()) {
      console.error(`[media-relay] channel ${MEDIA_RELAY_CHANNEL_ID} is missing or not sendable`);
      return;
    }
    await channel.send(buildMediaRelayEmbed(message.author.id, image.url));
  } catch (err) {
    console.error("[media-relay] failed to relay image", err);
  }
}
