import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { randomInt } from "node:crypto";
import { createVerifyCode } from "../db.js";
import { containerMessage } from "../ui.js";
import { resolveUsername } from "../robloxClient.js";

export const linkCommand = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Roblox username")
  .addStringOption((opt) =>
    opt.setName("roblox_username").setDescription("Your exact Roblox username").setRequired(true),
  );

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 ambiguity
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[randomInt(chars.length)];
  return code;
}

export async function handleLinkCommand(interaction: ChatInputCommandInteraction) {
  const robloxUsername = interaction.options.getString("roblox_username", true).trim();

  // Ack immediately — resolveUsername is a real network call to Roblox's API with unpredictable
  // latency, and missing Discord's 3s interaction window crashes the process (confirmed live for
  // a different command with the same shape of bug; deferReply has no such deadline).
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const resolved = await resolveUsername(robloxUsername);
  if (!resolved) {
    await interaction.editReply(
      containerMessage(`Couldn't find a Roblox user named "${robloxUsername}" — check the spelling.`),
    );
    return;
  }

  const code = generateCode();
  await createVerifyCode(interaction.user.id, resolved.name, resolved.id, code);

  await interaction.editReply(
    containerMessage([
      `Roblox username set to **${resolved.name}**.`,
      `In-game, type: \`;verify ${code}\``,
      `This code only works if you're actually logged in as that Roblox account.`,
    ]),
  );
}
