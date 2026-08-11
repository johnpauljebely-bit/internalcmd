import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { findLinkByDiscordId, getCallsignsByDiscordId } from "../db.js";
import { containerMessage, infoCard, type InfoField } from "../ui.js";
import { formatCallsignBlock } from "../callsignFormat.js";

export const mylinkCommand = new SlashCommandBuilder()
  .setName("mylink")
  .setDescription("View your linked Roblox account and callsign info");

export async function handleMylinkCommand(interaction: ChatInputCommandInteraction) {
  const link = await findLinkByDiscordId(interaction.user.id);
  if (!link) {
    await interaction.reply(
      containerMessage("You're not linked yet. Run /link to get started.", { ephemeral: true }),
    );
    return;
  }

  const fields: InfoField[] = [
    { label: "Discord", value: `<@${interaction.user.id}>` },
    { label: "Roblox username", value: link.roblox_username },
    { label: "Verified", value: new Date(link.verified_at).toLocaleString() },
  ];

  const callsigns = await getCallsignsByDiscordId(interaction.user.id);
  if (callsigns.length === 0) {
    fields.push({ label: "Callsign", value: "None assigned" });
  } else {
    for (const cs of callsigns) {
      fields.push({ label: `Callsign — ${cs.department.toUpperCase()}`, value: formatCallsignBlock(cs) });
    }
  }

  await interaction.reply(infoCard("My Link", fields, { ephemeral: true }));
}
