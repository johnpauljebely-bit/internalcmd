import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { findLinkByDiscordId } from "../db.js";
import { containerMessage } from "../ui.js";
import { announceToRTO } from "../discordBot.js";
import { announceToActiveDispatcher } from "../voice/activeDispatcherRegistry.js";
import { formatPlateForSpeech } from "../speechFormat.js";

export const boloCommand = new SlashCommandBuilder()
  .setName("bolo")
  .setDescription("Broadcast a BOLO to the RTO channel and voice dispatcher")
  .addStringOption((opt) =>
    opt.setName("description").setDescription("What to look for / why").setRequired(true),
  )
  .addStringOption((opt) => opt.setName("vehicle").setDescription("Vehicle description").setRequired(false))
  .addStringOption((opt) => opt.setName("plate").setDescription("License plate").setRequired(false));

export async function handleBoloCommand(interaction: ChatInputCommandInteraction) {
  const link = await findLinkByDiscordId(interaction.user.id);
  if (!link) {
    await interaction.reply(
      containerMessage("You need to be linked (/link) to issue a BOLO.", { ephemeral: true }),
    );
    return;
  }

  const description = interaction.options.getString("description", true);
  const vehicle = interaction.options.getString("vehicle");
  const plate = interaction.options.getString("plate");

  // Ack immediately — announcing (RTO + in-game PA + TTS synthesis) can easily take longer than
  // Discord's 3s interaction window (confirmed live: it did, and the resulting expired-
  // interaction reply crashed the whole process before this fix). deferReply/editReply has no
  // such deadline.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parts = [`BOLO: ${description}.`];
  if (vehicle) parts.push(`Vehicle: ${vehicle}.`);
  if (plate) parts.push(`Plate: ${plate}.`);
  const message = parts.join(" ");

  // The spoken version reads the plate with the NATO phonetic alphabet, per request — RTO text
  // keeps the literal plate since that's read, not heard.
  const spokenParts = [`BOLO: ${description}.`];
  if (vehicle) spokenParts.push(`Vehicle: ${vehicle}.`);
  if (plate) spokenParts.push(`Plate: ${formatPlateForSpeech(plate)}.`);
  const spokenMessage = spokenParts.join(" ");

  // 2026-08-14: no longer sent through ER:LC's in-game :h PA — dispatch/police radio traffic
  // stays on Discord (text + voice) only now, per explicit user request; :h is visible to every
  // player in the server including civilians. Also spoken through the voice dispatcher if one's
  // currently enabled (no-ops otherwise).
  await Promise.all([announceToRTO(message), announceToActiveDispatcher(spokenMessage)]);

  await interaction.editReply(containerMessage("BOLO broadcast sent."));
}
