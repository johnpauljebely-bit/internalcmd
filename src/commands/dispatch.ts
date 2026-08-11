import { SlashCommandBuilder, ChannelType, type ChatInputCommandInteraction } from "discord.js";
import { DISPATCH_ADMIN_ROLE_IDS } from "../config.js";
import { containerMessage } from "../ui.js";
import { startVoiceDispatcher, type VoiceDispatcherHandle } from "../voice/voiceSession.js";

export const dispatchCommand = new SlashCommandBuilder()
  .setName("dispatch")
  .setDescription("Enable or disable the voice dispatcher")
  .addSubcommand((sub) =>
    sub
      .setName("enable")
      .setDescription("Join a voice channel and start listening")
      .addChannelOption((opt) =>
        opt
          .setName("voice_channel")
          .setDescription("Voice channel to join as the dispatch radio")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) => sub.setName("disable").setDescription("Stop the voice dispatcher"));

let activeHandle: VoiceDispatcherHandle | null = null;

function hasPermission(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inCachedGuild()) return false;
  return interaction.member.roles.cache.some((r) => DISPATCH_ADMIN_ROLE_IDS.includes(r.id));
}

export async function handleDispatchCommand(interaction: ChatInputCommandInteraction) {
  if (!hasPermission(interaction)) {
    await interaction.reply(
      containerMessage("You need a Director, Executive-tier, or Manager role to use this.", {
        ephemeral: true,
      }),
    );
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "disable") {
    if (!activeHandle) {
      await interaction.reply(containerMessage("Voice dispatcher isn't enabled.", { ephemeral: true }));
      return;
    }
    activeHandle.stop();
    activeHandle = null;
    await interaction.reply(containerMessage("Voice dispatcher disabled."));
    return;
  }

  if (activeHandle) {
    await interaction.reply(containerMessage("Voice dispatcher is already enabled.", { ephemeral: true }));
    return;
  }

  const channel = interaction.options.getChannel("voice_channel", true, [ChannelType.GuildVoice]);

  await interaction.deferReply();
  try {
    activeHandle = await startVoiceDispatcher(channel);
    await interaction.editReply(containerMessage(`Voice dispatcher enabled in **${channel.name}**.`));
  } catch (err) {
    console.error("[dispatch] failed to enable voice dispatcher", err);
    await interaction.editReply(containerMessage("Failed to enable the voice dispatcher — check the logs."));
  }
}
