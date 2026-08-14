import { getServerPlayers, sendPrivateMessage } from "./erlcClient.js";
import { findLinkByRobloxUserId, getCadLastSeen } from "./db.js";
import { CAD_REMINDER_INTERVAL_MS, CAD_ACTIVITY_STALE_MS, TEAM_TO_DEPARTMENT } from "./config.js";

// Filter-safe by design — goes out over Roblox in-game chat (PM), which passes through Roblox's
// chat filter (per the user's own explicit note: "roblox chat allowed tho" — no profanity).
const REMINDER_MESSAGE = "Get onto the CAD dashboard now — you're expected to be logged in while on duty.";

// Every 2 minutes: any online, LINKED, on-duty LEO (Team maps to a department) whose
// cad_activity.last_seen_at is missing or stale gets PM'd to get on the CAD dashboard. Unlinked
// players are NOT nagged here — they're already covered by joinReminder.ts's separate "link your
// account" message, and there's no discord_id to check cad_activity against anyway. No grace
// period, same as joinReminder.ts — just a recurring nudge until they're actually on CAD.
export function startCadReminder() {
  setInterval(async () => {
    const players = await getServerPlayers();
    if (!players || players.length === 0) return;

    const now = Date.now();

    for (const p of players) {
      const department = p.Team ? TEAM_TO_DEPARTMENT[p.Team] : undefined;
      if (!department) continue;

      const username = p.Player.split(":")[0];
      const robloxUserId = p.Player.split(":")[1];
      if (!robloxUserId) continue;

      const link = await findLinkByRobloxUserId(robloxUserId);
      if (!link) continue;

      const lastSeen = await getCadLastSeen(link.discord_id);
      const isActive = lastSeen !== null && now - lastSeen.getTime() <= CAD_ACTIVITY_STALE_MS;
      if (isActive) continue;

      await sendPrivateMessage(username, REMINDER_MESSAGE);
    }
  }, CAD_REMINDER_INTERVAL_MS);

  console.log(`[cad-reminder] started, polling every ${CAD_REMINDER_INTERVAL_MS / 60_000}min`);
}
