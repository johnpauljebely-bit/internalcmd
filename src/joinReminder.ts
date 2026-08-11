import { getServerPlayers, sendPrivateMessage } from "./erlcClient.js";
import { findLinkByRobloxUserId } from "./db.js";
import { DISCORD_JOIN_CODE, JOIN_REMINDER_INTERVAL_MS } from "./config.js";

const REMINDER_MESSAGE = `Join our Discord to link your account and access comms — use code ${DISCORD_JOIN_CODE} to get in.`;

// Every 3 minutes: any online player with no `links` row (never ran `;verify`) gets PM'd the
// join code. No grace period or tracking state needed here — unlike compliance enforcement this
// is just a recurring nudge, so it's fine to PM the same person every single poll until they link.
export function startJoinReminder() {
  setInterval(async () => {
    const players = await getServerPlayers();
    if (!players || players.length === 0) return;

    for (const p of players) {
      const username = p.Player.split(":")[0];
      const robloxUserId = p.Player.split(":")[1];
      if (!robloxUserId) continue;

      const link = await findLinkByRobloxUserId(robloxUserId);
      if (link) continue;

      await sendPrivateMessage(username, REMINDER_MESSAGE);
    }
  }, JOIN_REMINDER_INTERVAL_MS);

  console.log(`[join-reminder] started, polling every ${JOIN_REMINDER_INTERVAL_MS / 60_000}min`);
}
