import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { GUILD_ID, RTO_CHANNEL_ID, SERVER_MANAGEMENT_CHANNEL_ID } from "./config.js";
import { linkCommand, handleLinkCommand } from "./commands/link.js";
import { callsignCommand, handleCallsignCommand } from "./commands/callsign.js";
import { mylinkCommand, handleMylinkCommand } from "./commands/mylink.js";
import { boloCommand, handleBoloCommand } from "./commands/bolo.js";
import { dispatchCommand, handleDispatchCommand } from "./commands/dispatch.js";
import {
  sessionPanelCommand,
  sessionStartCommand,
  sessionDownCommand,
  handleSessionPanelCommand,
  handleSessionStartCommand,
  handleSessionDownCommand,
  isSessionButtonCustomId,
  handleSessionButtonInteraction,
} from "./commands/session.js";
import { handleMediaRelayMessage } from "./mediaRelay.js";
import { handleEmbedCommand } from "./embedCommand.js";
import { handleGuildMemberAdd } from "./welcomeMessage.js";
import {
  handleDashboardCommand,
  isDashboardButtonCustomId,
  handleDashboardButtonInteraction,
} from "./dashboardCommand.js";
import { containerMessage } from "./ui.js";

// GuildMessages + MessageContent added 2026-08-14 for the !media/!embed commands — MessageContent
// is a privileged intent that also needs to be manually enabled in the Discord Developer Portal
// for this bot's application, or message.content will come through empty even with this bit set.
// GuildMembers (same day, for the welcome-message feature's guildMemberAdd event) is ALSO
// privileged and needs the same manual "Server Members Intent" toggle. Both flagged in
// NEEDS_HUMAN_VERIFICATION.md.
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.on("messageCreate", (message) => {
  handleMediaRelayMessage(message).catch((err) => console.error("[media-relay] handler errored", err));
  handleEmbedCommand(message).catch((err) => console.error("[embed] handler errored", err));
  handleDashboardCommand(message).catch((err) => console.error("[dashboard] handler errored", err));
});

client.on("guildMemberAdd", (member) => {
  handleGuildMemberAdd(member).catch((err) => console.error("[welcome] handler errored", err));
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
  if (
    interaction.isButton() &&
    !isSessionButtonCustomId(interaction.customId) &&
    !isDashboardButtonCustomId(interaction.customId)
  ) {
    return;
  }

  const label = interaction.isChatInputCommand() ? interaction.commandName : interaction.customId;

  try {
    // A plain `if (interaction.isButton())` (not combined with `&&` into the same condition as
    // the custom-id checks) is what lets TypeScript actually narrow the type across every
    // subsequent `else if` below — a compound `isButton() && isX(...)` condition being false
    // doesn't tell TS which half failed, so it can't exclude ButtonInteraction from the union for
    // the rest of the chain. Learned this the hard way rewriting this block today.
    if (interaction.isButton()) {
      if (isSessionButtonCustomId(interaction.customId)) {
        await handleSessionButtonInteraction(interaction);
      } else {
        await handleDashboardButtonInteraction(interaction);
      }
    } else if (interaction.commandName === "link") {
      await handleLinkCommand(interaction);
    } else if (interaction.commandName === "callsign") {
      await handleCallsignCommand(interaction);
    } else if (interaction.commandName === "mylink") {
      await handleMylinkCommand(interaction);
    } else if (interaction.commandName === "bolo") {
      await handleBoloCommand(interaction);
    } else if (interaction.commandName === "dispatch") {
      await handleDispatchCommand(interaction);
    } else if (interaction.commandName === "sessionpanel") {
      await handleSessionPanelCommand(interaction);
    } else if (interaction.commandName === "sessionstart") {
      await handleSessionStartCommand(interaction);
    } else if (interaction.commandName === "sessiondown") {
      await handleSessionDownCommand(interaction);
    }
  } catch (err) {
    console.error(`[discord] interaction "${label}" errored`, err);
    // Never let a failed error-recovery attempt itself crash the process (confirmed this
    // happened for real: a slow command missed Discord's 3s ACK window, the interaction expired,
    // and this fallback's own reply() call threw "Unknown interaction" as an unhandled
    // rejection — took the entire bot down, webhook receiver and active voice session included).
    try {
      const reply = containerMessage("Something went wrong.", { ephemeral: true });
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch (replyErr) {
      console.error(`[discord] failed to report the error back to the user for "${label}"`, replyErr);
    }
  }
});

// Last-resort safety net — a single unhandled rejection anywhere (a missed await, a library
// throwing outside a try/catch) should never take down the webhook receiver or an active voice
// session. Confirmed this is a real risk, not theoretical: exactly this happened live.
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled rejection (kept running)", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] uncaught exception (kept running)", err);
});

export async function registerCommands(token: string, applicationId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationId, GUILD_ID), {
    body: [
      linkCommand.toJSON(),
      callsignCommand.toJSON(),
      mylinkCommand.toJSON(),
      boloCommand.toJSON(),
      dispatchCommand.toJSON(),
      sessionPanelCommand.toJSON(),
      sessionStartCommand.toJSON(),
      sessionDownCommand.toJSON(),
    ],
  });
  console.log(
    "[discord] registered guild slash commands: /link, /callsign, /mylink, /bolo, /dispatch, " +
      "/sessionpanel, /sessionstart, /sessiondown",
  );
}

export async function startBot(token: string, applicationId: string) {
  await registerCommands(token, applicationId);
  await client.login(token);
  console.log(`[discord] logged in as ${client.user?.tag}`);
}

export async function getGuild() {
  return client.guilds.fetch(GUILD_ID);
}

async function sendToChannel(channelId: string, message: string) {
  await sendPayloadToChannel(channelId, containerMessage(message));
}

// Generalized version of sendToChannel for callers with a fully custom Components V2 payload
// (e.g. the verification log embed) rather than a plain text message.
async function sendPayloadToChannel(channelId: string, payload: unknown) {
  const guild = await getGuild();
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) {
    console.error(`[discord] channel ${channelId} is not text-capable, cannot send`);
    return;
  }
  await channel.send(payload as never);
}

export async function announceToRTO(message: string) {
  await sendToChannel(RTO_CHANNEL_ID, message);
}

export async function logToServerManagement(message: string) {
  await sendToChannel(SERVER_MANAGEMENT_CHANNEL_ID, message);
}

export async function logPayloadToServerManagement(payload: unknown) {
  await sendPayloadToChannel(SERVER_MANAGEMENT_CHANNEL_ID, payload);
}

// Returns whether the DM actually sent — callers that need to know (e.g. the verification embed's
// rundown checklist) can now tell success from failure instead of it being swallowed silently.
export async function dmUser(discordId: string, message: string): Promise<boolean> {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(containerMessage(message));
    return true;
  } catch (err) {
    console.error(`[discord] failed to DM ${discordId}`, err);
    return false;
  }
}

// For the verification embed's "Discord Username" field — returns null if the fetch fails
// (tracked in the embed's rundown as "Discord Info Fetch": □).
export async function fetchDiscordUsername(discordId: string): Promise<string | null> {
  try {
    const user = await client.users.fetch(discordId);
    return user.username;
  } catch (err) {
    console.error(`[discord] failed to fetch user ${discordId}`, err);
    return null;
  }
}
