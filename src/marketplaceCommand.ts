import { MessageFlags, type Message, type ButtonInteraction } from "discord.js";
import { randomInt } from "node:crypto";
import { MARKETPLACE_ADMIN_ROLE_IDS, MARKETPLACE_ITEMS, DELTA_PLUS_ROLE_ID, XMARK_EMOJI, CHECKMARK_EMOJI } from "./config.js";
import { containerMessage } from "./ui.js";
import { buildMarketplacePanel, buildMarketplaceFaqEmbed, buildClaimCodeDm } from "./marketplaceEmbeds.js";
import { findLinkByDiscordId, hasClaimedMarketplaceItem, createMarketplaceClaim, findMarketplaceClaimByCode } from "./db.js";
import { checkOwnsGamepass } from "./robloxClient.js";
import { getGuild, dmPayload } from "./discordBot.js";

export async function handleMarketplaceCommand(message: Message): Promise<void> {
  if (message.content.trim() !== "!marketplace") return;
  if (!message.member?.roles.cache.some((r) => MARKETPLACE_ADMIN_ROLE_IDS.includes(r.id))) return;
  if (!message.channel.isSendable()) return;

  await message.channel.send(buildMarketplacePanel());
}

export function isMarketplaceButtonCustomId(customId: string): boolean {
  return customId === "marketplace_claim_purchase" || customId === "marketplace_faq";
}

function generateClaimCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 ambiguity, same alphabet as /link's code
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[randomInt(chars.length)];
  return code;
}

async function uniqueClaimCode(): Promise<string> {
  let code = generateClaimCode();
  while (await findMarketplaceClaimByCode(code)) {
    code = generateClaimCode();
  }
  return code;
}

// UNCONFIRMED role assignment (DELTA_PLUS_ROLE_ID isn't set — see config.ts) — skips and logs
// rather than guessing, same pattern as assignVerificationRoles in chatCommands.ts.
async function assignDeltaPlusRole(discordId: string): Promise<void> {
  if (!DELTA_PLUS_ROLE_ID) {
    console.warn("[marketplace] Delta Plus role assignment skipped — DELTA_PLUS_ROLE_ID not configured");
    return;
  }
  try {
    const guild = await getGuild();
    const member = await guild.members.fetch(discordId);
    await member.roles.add(DELTA_PLUS_ROLE_ID);
  } catch (err) {
    console.error(`[marketplace] Delta Plus role assignment failed for discord=${discordId}`, err);
  }
}

async function handleClaimPurchase(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const link = await findLinkByDiscordId(interaction.user.id);
  if (!link || !link.roblox_user_id) {
    await interaction.editReply(
      containerMessage(`${XMARK_EMOJI} Your account isn't linked. Run \`/link\` in the command channel and join ingame.`),
    );
    return;
  }

  // Checks each marketplace item with a gamepass (Donations has none — ticket-only) in listed
  // order, skipping ones this Roblox account already claimed, and claims the first one they
  // actually own. This is what makes clicking the button again later (after buying something new)
  // still work — it doesn't just re-check the first item forever.
  for (const item of MARKETPLACE_ITEMS) {
    if (!item.gamepassId) continue;
    if (await hasClaimedMarketplaceItem(link.roblox_user_id, item.key)) continue;

    const owned = await checkOwnsGamepass(link.roblox_user_id, item.gamepassId);
    if (!owned) continue;

    const code = await uniqueClaimCode();
    const claimedAtUnixSeconds = Math.floor(Date.now() / 1000);

    await createMarketplaceClaim({
      code,
      discordId: interaction.user.id,
      robloxUserId: link.roblox_user_id,
      robloxUsername: link.roblox_username,
      itemKey: item.key,
      itemName: item.name,
    });

    if (item.key === "delta_plus") {
      await assignDeltaPlusRole(interaction.user.id);
    }

    const dmSent = await dmPayload(
      interaction.user.id,
      buildClaimCodeDm({
        code,
        robloxUsername: link.roblox_username,
        robloxUserId: link.roblox_user_id,
        claimedAtUnixSeconds,
        itemName: item.name,
      }),
    );
    if (!dmSent) {
      console.warn(`[marketplace] claim code DM failed for discord=${interaction.user.id} — code ${code} still valid, retrievable via /check`);
    }

    await interaction.editReply(containerMessage(`${CHECKMARK_EMOJI} Sucessfully claimed. Check your DMs then open a ticket.`));
    return;
  }

  await interaction.editReply(containerMessage(`${XMARK_EMOJI} Purchase claim **failed**. Check our FAQ section then open a ticket.`));
}

export async function handleMarketplaceButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === "marketplace_faq") {
    await interaction.reply(buildMarketplaceFaqEmbed());
  } else if (interaction.customId === "marketplace_claim_purchase") {
    await handleClaimPurchase(interaction);
  }
}
