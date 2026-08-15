import type { GuildMember } from "discord.js";
import { getGuild } from "./discordBot.js";
import { WELCOME_CHANNEL_ID, WELCOME_ROLE_ID } from "./config.js";
import { buildWelcomeMessage } from "./sessionEmbeds.js";

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  try {
    await member.roles.add(WELCOME_ROLE_ID);
  } catch (err) {
    console.error(`[welcome] failed to assign role to ${member.id}`, err);
  }

  try {
    const guild = await getGuild();
    const channel = await guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isSendable()) {
      console.error(`[welcome] channel ${WELCOME_CHANNEL_ID} is missing or not sendable`);
      return;
    }
    await channel.send(buildWelcomeMessage(member.id, guild.memberCount));
  } catch (err) {
    console.error(`[welcome] failed to send welcome message for ${member.id}`, err);
  }
}
