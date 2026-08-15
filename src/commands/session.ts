import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type TextChannel,
} from "discord.js";
import { getGuild } from "../discordBot.js";
import { containerMessage } from "../ui.js";
import { getServerInfo, kickPlayer, announcePA } from "../erlcClient.js";
import {
  SESSION_CHANNEL_ID,
  SESSION_PING_ROLE_ID,
  SESSION_ADMIN_ROLE_IDS,
  SESSION_JOIN_CODE,
  SESSION_SERVER_OWNER,
  SESSION_VOTE_THRESHOLD,
  SESSION_PANEL_UPDATE_INTERVAL_MS,
} from "../config.js";
import {
  buildSessionPanel,
  buildSessionVotePanel,
  buildSessionStartupPanel,
  buildSessionFullPanel,
  buildSessionShutdownPanel,
  type SessionPanelStats,
} from "../sessionEmbeds.js";

// "Delta City Roleplay I VC Based" per the sessionpanel spec — deliberately a different literal
// string from the session start-up panel's "Delta Roleplay I VC Based" (no "City"), matching
// exactly what was specified for each rather than unifying them, in case the difference is
// intentional (e.g. a formal vs. casual name).
const PRIVATE_SERVER_NAME_PANEL = "Delta City Roleplay I VC Based";
const PRIVATE_SERVER_NAME_STARTUP = "Delta Roleplay I VC Based";

// All in-memory, mirrors this codebase's other transient session-lifecycle state (pursuit.ts) —
// a bot restart mid-session just means re-running /sessionpanel or /sessionstart.
interface SessionRuntimeState {
  panelChannelId: string | null;
  panelMessageId: string | null;
  voteMessageId: string | null;
  voters: Map<string, number>; // discordId -> unix seconds cast
  sessionActive: boolean;
  fullyAnnounced: boolean;
}

const state: SessionRuntimeState = {
  panelChannelId: null,
  panelMessageId: null,
  voteMessageId: null,
  voters: new Map(),
  sessionActive: false,
  fullyAnnounced: false,
};

function hasSessionPermission(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inCachedGuild()) return false;
  return interaction.member.roles.cache.some((r) => SESSION_ADMIN_ROLE_IDS.includes(r.id));
}

async function getSessionChannel(): Promise<TextChannel | null> {
  const guild = await getGuild();
  const channel = await guild.channels.fetch(SESSION_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    console.error(`[session] channel ${SESSION_CHANNEL_ID} is missing or not sendable`);
    return null;
  }
  return channel as TextChannel;
}

// Server-Moderator/Administrator/Owner/Co-Owner style Permission strings, per ER:LC's documented
// values — UNCONFIRMED against a real live response (server has always been empty when checked).
// Counts anyone whose Permission isn't the plain "Normal" default as staff, a defensive heuristic
// rather than an exact allowlist, so it degrades gracefully if the exact string set is wrong.
function isStaffPermission(permission: string | undefined): boolean {
  return !!permission && permission !== "Normal";
}

async function fetchPanelStats(): Promise<SessionPanelStats> {
  const info = await getServerInfo();
  const players = info?.players ?? [];
  return {
    players: info?.currentPlayers ?? players.length,
    staff: players.filter((p) => isStaffPermission(p.Permission)).length,
    queue: info?.queue ?? null,
    privateServerName: PRIVATE_SERVER_NAME_PANEL,
    privateServerOwner: SESSION_SERVER_OWNER,
    joinCode: SESSION_JOIN_CODE,
  };
}

// ---------------------------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------------------------
export const sessionPanelCommand = new SlashCommandBuilder()
  .setName("sessionpanel")
  .setDescription("Post the live session panel (players/staff/queue) in the session channel");

export const sessionStartCommand = new SlashCommandBuilder()
  .setName("sessionstart")
  .setDescription("Start a session vote in the session channel");

export const sessionDownCommand = new SlashCommandBuilder()
  .setName("sessiondown")
  .setDescription("Shut the session down — warns, kicks everyone, and purges the session channel");

const NO_PERMISSION_MESSAGE = "You need a Management Team role or higher to use this.";

export async function handleSessionPanelCommand(interaction: ChatInputCommandInteraction) {
  if (!hasSessionPermission(interaction)) {
    await interaction.reply(containerMessage(NO_PERMISSION_MESSAGE, { ephemeral: true }));
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const channel = await getSessionChannel();
  if (!channel) {
    await interaction.editReply("Session channel is missing or not sendable — check config.");
    return;
  }

  const stats = await fetchPanelStats();
  const message = await channel.send(buildSessionPanel(stats));
  state.panelChannelId = channel.id;
  state.panelMessageId = message.id;

  await interaction.editReply("Session panel posted.");
}

export async function handleSessionStartCommand(interaction: ChatInputCommandInteraction) {
  if (!hasSessionPermission(interaction)) {
    await interaction.reply(containerMessage(NO_PERMISSION_MESSAGE, { ephemeral: true }));
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const channel = await getSessionChannel();
  if (!channel) {
    await interaction.editReply("Session channel is missing or not sendable — check config.");
    return;
  }

  state.voters = new Map();
  state.sessionActive = true;
  state.fullyAnnounced = false;

  const message = await channel.send(buildSessionVotePanel(SESSION_PING_ROLE_ID));
  state.voteMessageId = message.id;

  await interaction.editReply("Session vote started.");
}

async function runShutdownSequence(): Promise<void> {
  await announcePA(
    "A session shutdown has been initiated. Thank you for playing at Delta Roleplay. Join our comms with the code ZMKNFxzNTX",
  );

  await new Promise((resolve) => setTimeout(resolve, 60_000));
  await announcePA("Everyone will be kicked in 30 seconds. Please join ZMKNFxzNTX. Have a great day.");

  await new Promise((resolve) => setTimeout(resolve, 30_000));

  const info = await getServerInfo();
  for (const p of info?.players ?? []) {
    const username = p.Player.split(":")[0];
    await kickPlayer(username);
  }

  const channel = await getSessionChannel();
  if (channel) {
    await purgeChannelExcept(channel, state.panelMessageId);
    await channel.send(buildSessionShutdownPanel());
  }

  state.sessionActive = false;
  state.fullyAnnounced = false;
}

// Bulk-delete only works on messages under 14 days old and caps at 100 per call — falls back to
// individual deletes for anything older/left over. Keeps the tracked panel message untouched.
async function purgeChannelExcept(channel: TextChannel, keepMessageId: string | null): Promise<void> {
  try {
    let fetched = await channel.messages.fetch({ limit: 100 });
    while (fetched.size > 0) {
      const toDelete = fetched.filter((m) => m.id !== keepMessageId);
      if (toDelete.size > 0) {
        try {
          await channel.bulkDelete(toDelete, true);
        } catch (err) {
          console.warn("[session] bulkDelete failed (likely messages >14 days old), falling back to individual deletes", err);
          for (const m of toDelete.values()) {
            await m.delete().catch(() => {});
          }
        }
      }
      const last = fetched.last();
      if (!last || fetched.size < 100) break;
      fetched = await channel.messages.fetch({ limit: 100, before: last.id });
    }
  } catch (err) {
    console.error("[session] failed to purge session channel", err);
  }
}

export async function handleSessionDownCommand(interaction: ChatInputCommandInteraction) {
  if (!hasSessionPermission(interaction)) {
    await interaction.reply(containerMessage(NO_PERMISSION_MESSAGE, { ephemeral: true }));
    return;
  }

  await interaction.reply(
    containerMessage("Session shutdown initiated — this takes about 90 seconds.", { ephemeral: true }),
  );

  // Long-running (90s+) — deliberately not awaited here so the interaction doesn't hang; errors
  // inside are caught by the process-wide safety net in discordBot.ts either way.
  runShutdownSequence().catch((err) => console.error("[session] shutdown sequence failed", err));
}

// ---------------------------------------------------------------------------------------------
// Button interactions — routed from discordBot.ts's interactionCreate handler.
// ---------------------------------------------------------------------------------------------
export function isSessionButtonCustomId(customId: string): boolean {
  return (
    customId === "session_cast_vote" ||
    customId === "session_list_voters" ||
    customId === "session_notification_toggle"
  );
}

async function handleCastVote(interaction: ButtonInteraction): Promise<void> {
  if (state.voters.has(interaction.user.id)) {
    await interaction.reply(containerMessage("You've already voted.", { ephemeral: true }));
    return;
  }

  state.voters.set(interaction.user.id, Math.floor(Date.now() / 1000));
  await interaction.reply(containerMessage(`Vote cast — ${state.voters.size}/${SESSION_VOTE_THRESHOLD}.`, { ephemeral: true }));

  if (state.voters.size < SESSION_VOTE_THRESHOLD) return;

  const voterIds = [...state.voters.keys()];
  const channel = await getSessionChannel();
  if (!channel) return;

  if (state.voteMessageId) {
    const voteMessage = await channel.messages.fetch(state.voteMessageId).catch(() => null);
    await voteMessage?.delete().catch(() => {});
  }

  await channel.send(buildSessionStartupPanel(PRIVATE_SERVER_NAME_STARTUP, voterIds));
  state.voters = new Map();
  state.voteMessageId = null;
}

async function handleListVoters(interaction: ButtonInteraction): Promise<void> {
  const lines = [`## Voters: ${state.voters.size}/${SESSION_VOTE_THRESHOLD}`];
  for (const [voterId, castAt] of state.voters) {
    lines.push(`-# Vote casted by <@${voterId}> at <t:${castAt}:R>`);
    lines.push(`-# <@${voterId}>`);
  }
  await interaction.reply(containerMessage(lines.join("\n"), { ephemeral: true }));
}

async function handleNotificationToggle(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const member = interaction.member;
  const hasRole = member.roles.cache.has(SESSION_PING_ROLE_ID);

  try {
    if (hasRole) {
      await member.roles.remove(SESSION_PING_ROLE_ID);
      await interaction.reply(containerMessage("Session notifications turned off.", { ephemeral: true }));
    } else {
      await member.roles.add(SESSION_PING_ROLE_ID);
      await interaction.reply(containerMessage("Session notifications turned on — you'll be pinged for the next one.", { ephemeral: true }));
    }
  } catch (err) {
    console.error(`[session] failed to toggle notification role for ${interaction.user.id}`, err);
    await interaction.reply(containerMessage("Couldn't update your notification role — check my permissions.", { ephemeral: true }));
  }
}

export async function handleSessionButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === "session_cast_vote") {
    await handleCastVote(interaction);
  } else if (interaction.customId === "session_list_voters") {
    await handleListVoters(interaction);
  } else if (interaction.customId === "session_notification_toggle") {
    await handleNotificationToggle(interaction);
  }
}

// ---------------------------------------------------------------------------------------------
// 15s live-panel updater + full-capacity watcher. Both no-op when there's nothing tracked yet
// (no /sessionpanel run since the last restart, or no active session).
// ---------------------------------------------------------------------------------------------
export function startSessionPollers(): void {
  setInterval(async () => {
    if (!state.panelChannelId || !state.panelMessageId) return;

    const stats = await fetchPanelStats();

    try {
      const guild = await getGuild();
      const channel = await guild.channels.fetch(state.panelChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(state.panelMessageId).catch(() => null);
        await message?.edit(buildSessionPanel(stats));
      }
    } catch (err) {
      console.error("[session] failed to update live panel", err);
    }

    if (!state.sessionActive || state.fullyAnnounced) return;
    if (stats.players === 0) return; // MaxPlayers defaults to 0 when ER:LC data is unavailable — never treat that as "full"
    const info = await getServerInfo();
    if (!info || info.maxPlayers <= 0) return;
    if (info.currentPlayers < info.maxPlayers) return;

    const channel = await getSessionChannel();
    if (!channel) return;
    await channel.send(buildSessionFullPanel(Math.floor(Date.now() / 1000)));
    state.fullyAnnounced = true;
  }, SESSION_PANEL_UPDATE_INTERVAL_MS);

  console.log(`[session] pollers started, updating every ${SESSION_PANEL_UPDATE_INTERVAL_MS / 1000}s`);
}
