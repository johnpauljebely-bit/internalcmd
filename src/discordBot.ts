import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { GUILD_ID, RTO_CHANNEL_ID, SERVER_MANAGEMENT_CHANNEL_ID } from "./config.js";
import { linkCommand, handleLinkCommand } from "./commands/link.js";
import { callsignCommand, handleCallsignCommand } from "./commands/callsign.js";
import { mylinkCommand, handleMylinkCommand } from "./commands/mylink.js";
import { boloCommand, handleBoloCommand } from "./commands/bolo.js";
import { dispatchCommand, handleDispatchCommand } from "./commands/dispatch.js";
import { containerMessage } from "./ui.js";

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "link") {
      await handleLinkCommand(interaction);
    } else if (interaction.commandName === "callsign") {
      await handleCallsignCommand(interaction);
    } else if (interaction.commandName === "mylink") {
      await handleMylinkCommand(interaction);
    } else if (interaction.commandName === "bolo") {
      await handleBoloCommand(interaction);
    } else if (interaction.commandName === "dispatch") {
      await handleDispatchCommand(interaction);
    }
  } catch (err) {
    console.error(`[discord] command "${interaction.commandName}" errored`, err);
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
      console.error(`[discord] failed to report the error back to the user for "${interaction.commandName}"`, replyErr);
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
    ],
  });
  console.log("[discord] registered guild slash commands: /link, /callsign, /mylink, /bolo, /dispatch");
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
  const guild = await getGuild();
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isSendable()) {
    console.error(`[discord] channel ${channelId} is not text-capable, cannot send`);
    return;
  }
  await channel.send(containerMessage(message));
}

export async function announceToRTO(message: string) {
  await sendToChannel(RTO_CHANNEL_ID, message);
}

export async function logToServerManagement(message: string) {
  await sendToChannel(SERVER_MANAGEMENT_CHANNEL_ID, message);
}

export async function dmUser(discordId: string, message: string) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(containerMessage(message));
  } catch (err) {
    console.error(`[discord] failed to DM ${discordId}`, err);
  }
}
