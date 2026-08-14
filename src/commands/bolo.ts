import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { findLinkByDiscordId } from "../db.js";
import { containerMessage } from "../ui.js";
import { announceToRTO } from "../discordBot.js";
import { announcePA } from "../erlcClient.js";
import { announceToActiveDispatcher } from "../voice/activeDispatcherRegistry.js";
import { formatPlateForSpeech } from "../speechFormat.js";

export const boloCommand = new SlashCommandBuilder()
  .setName("bolo")
  .setDescription("Broadcast a BOLO to the RTO channel and in-game PA")
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
  // and in-game PA keep the literal plate since those are read, not heard.
  const spokenParts = [`BOLO: ${description}.`];
  if (vehicle) spokenParts.push(`Vehicle: ${vehicle}.`);
  if (plate) spokenParts.push(`Plate: ${formatPlateForSpeech(plate)}.`);
  const spokenMessage = spokenParts.join(" ");

  // Goes through Roblox's chat filter via virtual server management, same caveat as pursuit
  // announcements — test the exact phrasing in-game before relying on it. Also spoken through
  // the voice dispatcher if one's currently enabled (no-ops otherwise).
  await Promise.all([announceToRTO(message), announcePA(message), announceToActiveDispatcher(spokenMessage)]);

  await interaction.editReply(containerMessage("BOLO broadcast sent."));
}
