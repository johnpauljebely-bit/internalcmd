import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { MARKETPLACE_CHECK_ROLE_ID } from "../config.js";
import { containerMessage } from "../ui.js";
import { findMarketplaceClaimByCode } from "../db.js";
import { buildCheckResultEmbed } from "../marketplaceEmbeds.js";

export const checkCommand = new SlashCommandBuilder()
  .setName("check")
  .setDescription("Look up a marketplace claim code")
  .addStringOption((opt) => opt.setName("code").setDescription("The 6-character claim code").setRequired(true));

export async function handleCheckCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild() || !interaction.member.roles.cache.has(MARKETPLACE_CHECK_ROLE_ID)) {
    await interaction.reply(containerMessage("You don't have permission to use this.", { ephemeral: true }));
    return;
  }

  const code = interaction.options.getString("code", true).trim().toUpperCase();
  const claim = await findMarketplaceClaimByCode(code);

  if (!claim) {
    await interaction.reply(containerMessage(`No claim found for code \`${code}\`.`, { ephemeral: true }));
    return;
  }

  // Not ephemeral, deliberately — per the user's own payload for this (no Ephemeral flag set),
  // and it's meant to be visible in a ticket channel while staff process the redemption, same as
  // re-running /check on an already-claimed code always showing the same values (nothing new to
  // hide behind ephemeral each time).
  await interaction.reply(
    buildCheckResultEmbed({
      robloxUsername: claim.roblox_username,
      robloxUserId: claim.roblox_user_id,
      itemName: claim.item_name,
      claimedAtUnixSeconds: Math.floor(new Date(claim.claimed_at).getTime() / 1000),
    }),
  );
}
