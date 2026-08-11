import { getGuild, announceToRTO, dmUser, logToServerManagement } from "./discordBot.js";
import { firstEmptyChannel, moveMemberToChannel } from "./voiceMove.js";
import { consumeVerifyCode, findLinkByRobloxUserId, getCallsignsByDiscordId, type LinkRow } from "./db.js";
import { getServerPlayers, sendPrivateMessage, type ErlcPlayer } from "./erlcClient.js";
import { startPursuit, endPursuit } from "./pursuit.js";
import {
  STAFF_SCENE_VC_IDS,
  TRAFFIC_STOP_VC_IDS,
  SCENE_VC_IDS,
  RTO_CHANNEL_ID,
  DRAG_COMMAND_COOLDOWN_MS,
  PROXIMITY_STUDS,
  STAFF_WAITING_ROOM_VC_ID,
} from "./config.js";
import type { ChatEvent } from "./parseEvent.js";
import { isOnCooldown } from "./cooldown.js";
import { distance2D } from "./distance.js";
import { isSergeantOrAbove } from "./rankHierarchy.js";
import { matchPlayersByPartialUsername } from "./matchPlayer.js";

const lastDragCommandAt = new Map<string, number>();

function onCooldown(key: string): boolean {
  const now = Date.now();
  if (isOnCooldown(lastDragCommandAt.get(key), now, DRAG_COMMAND_COOLDOWN_MS)) return true;
  lastDragCommandAt.set(key, now);
  return false;
}

function distance(a: ErlcPlayer, b: ErlcPlayer): number {
  return distance2D(
    a.Location?.LocationX ?? 0,
    a.Location?.LocationZ ?? 0,
    b.Location?.LocationX ?? 0,
    b.Location?.LocationZ ?? 0,
  );
}

function playerRobloxId(p: ErlcPlayer): string | undefined {
  return p.Player.split(":")[1];
}

async function nearbyLinkedDiscordIds(senderRobloxId: string): Promise<string[]> {
  const players = await getServerPlayers();
  if (!players) return [];

  const sender = players.find((p) => playerRobloxId(p) === senderRobloxId);
  if (!sender) return [];

  const nearby = players.filter((p) => p !== sender && distance(sender, p) <= PROXIMITY_STUDS);

  const discordIds: string[] = [];
  for (const p of nearby) {
    const id = playerRobloxId(p);
    const link = id ? await findLinkByRobloxUserId(id) : undefined;
    if (link) discordIds.push(link.discord_id);
  }
  return discordIds;
}

async function handleVerify(event: ChatEvent) {
  const code = event.argument.trim();
  const result = await consumeVerifyCode(code, event.robloxUserId);
  if (result.ok) {
    console.log(`[verify] linked discord=${result.discordId} roblox=${result.robloxUsername}`);
    await dmUser(
      result.discordId,
      `Verification success — your Discord is now linked to Roblox user **${result.robloxUsername}**.`,
    );
    await logToServerManagement(`Verified: <@${result.discordId}> ↔ Roblox \`${result.robloxUsername}\``);
  } else {
    console.warn(`[verify] failed for roblox_id=${event.robloxUserId} code=${code}: ${result.reason}`);
    await logToServerManagement(
      `Verification failed for Roblox user id \`${event.robloxUserId}\` (code \`${code}\`): ${result.reason}`,
    );
  }
}

async function handleSS(link: LinkRow) {
  console.log(`[chat] ;ss from roblox_id=${link.roblox_user_id} (discord=${link.discord_id})`);
  if (onCooldown(link.discord_id)) {
    console.log(`[chat] ;ss ignored — ${link.discord_id} on cooldown`);
    return;
  }
  const guild = await getGuild();
  const channel = await firstEmptyChannel(guild, STAFF_SCENE_VC_IDS);
  if (!channel) {
    console.warn("[chat] ;ss — no staff scene channel available");
    return;
  }
  const moved = await moveMemberToChannel(guild, link.discord_id, channel);
  console.log(`[chat] ;ss moved=${moved} discord=${link.discord_id} -> ${channel.name}`);
}

async function handleTS(event: ChatEvent) {
  console.log(`[chat] ;ts from roblox_id=${event.robloxUserId}`);
  if (onCooldown(`ts:${event.robloxUserId}`)) {
    console.log(`[chat] ;ts ignored — ${event.robloxUserId} on cooldown`);
    return;
  }
  const guild = await getGuild();
  const channel = await firstEmptyChannel(guild, TRAFFIC_STOP_VC_IDS);
  if (!channel) {
    console.warn("[chat] ;ts — no traffic stop channel available");
    return;
  }
  const ids = await nearbyLinkedDiscordIds(event.robloxUserId);
  console.log(`[chat] ;ts moving ${ids.length} nearby linked player(s) to ${channel.name}`);
  for (const id of ids) await moveMemberToChannel(guild, id, channel);
}

async function handleScene(event: ChatEvent) {
  console.log(`[chat] ;scene from roblox_id=${event.robloxUserId}`);
  if (onCooldown(`scene:${event.robloxUserId}`)) {
    console.log(`[chat] ;scene ignored — ${event.robloxUserId} on cooldown`);
    return;
  }
  const guild = await getGuild();
  const channel = await firstEmptyChannel(guild, SCENE_VC_IDS);
  if (!channel) {
    console.warn("[chat] ;scene — no scene channel available");
    return;
  }
  const ids = await nearbyLinkedDiscordIds(event.robloxUserId);
  console.log(`[chat] ;scene moving ${ids.length} nearby linked player(s) to ${channel.name}`);
  for (const id of ids) await moveMemberToChannel(guild, id, channel);
}

async function handleTeam(link: LinkRow) {
  // No per-department VC exists in Discord yet — falls back to the RTO channel.
  // Revisit once real department VCs exist.
  console.log(`[chat] ;team from discord=${link.discord_id}`);
  if (onCooldown(link.discord_id)) {
    console.log(`[chat] ;team ignored — ${link.discord_id} on cooldown`);
    return;
  }
  const guild = await getGuild();
  const channel = await guild.channels.fetch(RTO_CHANNEL_ID);
  if (!channel || !channel.isVoiceBased()) {
    console.warn("[chat] ;team — RTO fallback channel is not voice-based");
    return;
  }
  const moved = await moveMemberToChannel(guild, link.discord_id, channel);
  console.log(`[chat] ;team moved=${moved} discord=${link.discord_id}`);
}

// Item #3's mod-call flow: ;mod (below) populates this when a caller is dragged into the waiting
// room; modCallDetector.ts reads + clears it once a staff member's own teleport-to-player command
// shows up in the ER:LC command log — auto-resolved, no manual confirm command (per the user's
// explicit 2026-08-11 instruction). In-memory only, matching this codebase's other transient
// session state (cooldowns, active pursuit) — a lost mod-call on a restart just means the player
// runs ;mod again.
export interface ModWaitEntry {
  robloxUsername: string;
  calledAt: number;
}
export const waitingForMod = new Map<string, ModWaitEntry>();

async function handleMod(event: ChatEvent, link: LinkRow) {
  console.log(`[chat] ;mod from roblox_id=${event.robloxUserId} (discord=${link.discord_id})`);
  if (onCooldown(`mod:${link.discord_id}`)) {
    console.log(`[chat] ;mod ignored — ${link.discord_id} on cooldown`);
    return;
  }

  // Real gap found while re-reading this: the drag cooldown alone doesn't stop someone from
  // re-triggering every 7s while ALREADY waiting (impatient re-typing is the obvious real-world
  // case) — each re-trigger would re-PM them and re-post a fresh server-management log line,
  // spamming staff with duplicate "waiting" alerts for the same still-open call. Gated behind the
  // cooldown check above so this itself can't be spammed faster than every 7s either.
  if (waitingForMod.has(link.discord_id)) {
    console.log(`[chat] ;mod ignored — ${link.discord_id} is already waiting for a mod`);
    await sendPrivateMessage(link.roblox_username, "You're already in the queue for a mod — hang tight.");
    return;
  }

  const guild = await getGuild();
  const channel = await guild.channels.fetch(STAFF_WAITING_ROOM_VC_ID).catch(() => null);
  if (!channel || !channel.isVoiceBased()) {
    console.warn("[chat] ;mod — configured waiting room channel is missing or not voice-based");
    return;
  }

  const moved = await moveMemberToChannel(guild, link.discord_id, channel);
  console.log(`[chat] ;mod moved=${moved} discord=${link.discord_id} -> ${channel.name}`);

  waitingForMod.set(link.discord_id, { robloxUsername: link.roblox_username, calledAt: Date.now() });
  await sendPrivateMessage(link.roblox_username, "You've been moved to the staff waiting room — a mod will be with you shortly.");
  await logToServerManagement(`Mod call: <@${link.discord_id}> (\`${link.roblox_username}\`) is waiting in the staff waiting room.`);
}

// Gated to Sergeant+ RCMP/BCHP — their choice to type it is the approval, no separate accept
// step. Checked against our own callsigns table (rank, not a raw numeric threshold — see
// rankHierarchy.ts for why). Delta PD has no rank ladder, so it never qualifies.
async function senderQualifiesForPursuit(link: LinkRow): Promise<boolean> {
  const callsigns = await getCallsignsByDiscordId(link.discord_id);
  return callsigns.some(
    (cs) =>
      (cs.department === "rcmp" || cs.department === "bchp") &&
      isSergeantOrAbove(cs.department, cs.rank),
  );
}

async function handlePS(event: ChatEvent, link: LinkRow) {
  if (!(await senderQualifiesForPursuit(link))) {
    console.log(`[chat] ;ps ignored — discord=${link.discord_id} is not a Sergeant+ RCMP/BCHP officer`);
    return;
  }

  if (event.argument.trim().toLowerCase() === "end") {
    await endPursuit();
    return;
  }

  const spaceIdx = event.argument.indexOf(" ");
  if (spaceIdx === -1) {
    await sendPrivateMessage(link.roblox_username, "Usage: ;ps [officer username] [vehicle description]");
    return;
  }

  const usernameQuery = event.argument.slice(0, spaceIdx).trim();
  const vehicleDescription = event.argument.slice(spaceIdx + 1).trim();

  const players = await getServerPlayers();
  if (!players) {
    await sendPrivateMessage(link.roblox_username, "Dispatch data temporarily unavailable — try again shortly.");
    return;
  }

  const matches = matchPlayersByPartialUsername(usernameQuery, players);
  if (matches.length === 0) {
    await sendPrivateMessage(link.roblox_username, `No player matching "${usernameQuery}" found online.`);
    return;
  }
  if (matches.length > 1) {
    const names = matches.map((p) => p.Player.split(":")[0]).join(", ");
    await sendPrivateMessage(
      link.roblox_username,
      `Multiple matches for "${usernameQuery}": ${names}. Be more specific.`,
    );
    return;
  }

  const targetId = matches[0].Player.split(":")[1];
  if (!targetId) return;

  await startPursuit(targetId, vehicleDescription);
}

export async function routeChatEvent(event: ChatEvent) {
  if (event.command === "verify") {
    await handleVerify(event);
    return;
  }

  // Every other command requires a linked account — silently ignored otherwise so
  // civilians/unlinked players can't trigger anything.
  const link = await findLinkByRobloxUserId(event.robloxUserId);
  if (!link) {
    console.log(`[chat] ;${event.command} ignored — roblox_id=${event.robloxUserId} is not linked`);
    return;
  }

  switch (event.command) {
    case "ss":
      await handleSS(link);
      break;
    case "ts":
      await handleTS(event);
      break;
    case "scene":
      await handleScene(event);
      break;
    case "team":
      await handleTeam(link);
      break;
    case "ps":
      await handlePS(event, link);
      break;
    case "mod":
      await handleMod(event, link);
      break;
    default:
      break;
  }
}
