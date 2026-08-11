import { getCommandLogs } from "./erlcClient.js";
import { sendPrivateMessage } from "./erlcClient.js";
import { findLinkByRobloxUsername } from "./db.js";
import { getGuild, logToServerManagement } from "./discordBot.js";
import { firstEmptyChannel, moveMemberToChannel } from "./voiceMove.js";
import { STAFF_SCENE_VC_IDS } from "./config.js";
import { waitingForMod } from "./chatCommands.js";

const POLL_INTERVAL_MS = 10_000;

// Same "baseline on first poll, only react to entries seen after that" pattern callDispatch.ts
// uses for calls — command logs are presumably an ever-growing history, and reacting to every
// historical teleport on startup would immediately (and wrongly) resolve every already-forgotten
// mod call from before this process even started.
let lastSeenTimestamp = 0;
let firstPoll = true;

// Per the user's explicit description (2026-08-11): "checking server logs for teleportations to
// the player e.g. clearly_jp tped to [player who requested mod]" — no confirmed ER:LC event for
// this, but a staff `:tp` command shows up in the command log, and that's the real signal to use.
// Exact command syntax is UNCONFIRMED (never observed live) — parsed defensively: treat any
// command containing the standalone word "tp" as a teleport, and check every other token against
// the currently-waiting usernames rather than assuming a fixed argument position/order.
function commandTargetsPlayer(command: string, robloxUsername: string): boolean {
  const tokens = command.trim().split(/\s+/);
  const hasTp = tokens.some((t) => t.toLowerCase().replace(/^:/, "") === "tp");
  if (!hasTp) return false;
  return tokens.some((t) => t.toLowerCase() === robloxUsername.toLowerCase());
}

// Auto-resolves a mod call once a staff member's own teleport-to-player command shows up in the
// log — no manual confirm command, per the user's explicit instruction (2026-08-11: "no mod
// arrived command its auto using what i just explained"). Moves BOTH the waiting caller and the
// teleporting staff member into a free staff scene channel together.
export function startModCallDetector() {
  setInterval(async () => {
    const logs = await getCommandLogs();
    if (!logs) return;

    if (firstPoll) {
      firstPoll = false;
      lastSeenTimestamp = Math.max(0, ...logs.map((l) => l.Timestamp ?? 0));
      return;
    }

    const newEntries = logs.filter((l) => (l.Timestamp ?? 0) > lastSeenTimestamp);
    lastSeenTimestamp = Math.max(lastSeenTimestamp, ...logs.map((l) => l.Timestamp ?? 0));

    if (newEntries.length === 0 || waitingForMod.size === 0) return;

    for (const entry of newEntries) {
      const modUsername = entry.Player?.split(":")[0];
      const command = entry.Command;
      if (!modUsername || !command) continue;

      for (const [discordId, wait] of waitingForMod) {
        if (!commandTargetsPlayer(command, wait.robloxUsername)) continue;

        waitingForMod.delete(discordId);
        console.log(`[mod-call] detected ${modUsername} -> ${wait.robloxUsername} via command log: "${command}"`);

        const guild = await getGuild();
        const channel = await firstEmptyChannel(guild, STAFF_SCENE_VC_IDS);
        if (!channel) {
          console.warn(`[mod-call] no available staff scene channel for ${wait.robloxUsername}`);
          break;
        }

        await moveMemberToChannel(guild, discordId, channel);

        const modLink = await findLinkByRobloxUsername(modUsername);
        if (modLink) {
          await moveMemberToChannel(guild, modLink.discord_id, channel);
        } else {
          console.warn(`[mod-call] ${modUsername} isn't linked — couldn't drag them into ${channel.name}, only the caller`);
        }

        await sendPrivateMessage(wait.robloxUsername, "A mod is with you now.");
        await logToServerManagement(
          `Mod call resolved: ${modUsername} reached <@${discordId}> — moved to ${channel.name}.`,
        );
        break;
      }
    }
  }, POLL_INTERVAL_MS);

  console.log(`[mod-call] auto-detection started, polling every ${POLL_INTERVAL_MS / 1000}s`);
}
