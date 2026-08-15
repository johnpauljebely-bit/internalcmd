import type { Message, ButtonInteraction } from "discord.js";
import { DISPATCH_ADMIN_ROLE_IDS } from "./config.js";
import { buildDashboardPanel, buildDiscordRulesEmbed, buildRobloxRulesEmbed } from "./sessionEmbeds.js";

export async function handleDashboardCommand(message: Message): Promise<void> {
  if (message.content.trim() !== "!dashboard") return;
  if (!message.member?.roles.cache.some((r) => DISPATCH_ADMIN_ROLE_IDS.includes(r.id))) return;
  if (!message.channel.isSendable()) return;

  await message.channel.send(buildDashboardPanel());
}

export function isDashboardButtonCustomId(customId: string): boolean {
  return customId === "dashboard_discord_rules" || customId === "dashboard_roblox_rules";
}

export async function handleDashboardButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === "dashboard_discord_rules") {
    await interaction.reply(buildDiscordRulesEmbed());
  } else if (interaction.customId === "dashboard_roblox_rules") {
    await interaction.reply(buildRobloxRulesEmbed());
  }
}
