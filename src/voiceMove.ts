import type { Guild, VoiceBasedChannel } from "discord.js";

export async function firstEmptyChannel(
  guild: Guild,
  channelIds: string[],
): Promise<VoiceBasedChannel | null> {
  for (const id of channelIds) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (channel && channel.isVoiceBased() && channel.members.size === 0) {
      return channel;
    }
  }
  // All full/occupied — fall back to the first one in the pool rather than doing nothing.
  const fallback = await guild.channels.fetch(channelIds[0]).catch(() => null);
  return fallback && fallback.isVoiceBased() ? fallback : null;
}

export async function moveMemberToChannel(
  guild: Guild,
  discordId: string,
  channel: VoiceBasedChannel,
): Promise<boolean> {
  try {
    const member = await guild.members.fetch(discordId);
    if (!member.voice.channelId) {
      console.log(`[voice] ${discordId} is not currently in a voice channel — can't move`);
      return false;
    }
    await member.voice.setChannel(channel);
    return true;
  } catch (err) {
    console.error(`[voice] failed to move ${discordId} to ${channel.id}`, err);
    return false;
  }
}
