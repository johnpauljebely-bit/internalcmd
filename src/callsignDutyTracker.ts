import { getServerPlayers } from "./erlcClient.js";
import { findLinkByDiscordId, getAllCallsigns, incrementCallsignDuty, upsertLiveUnit } from "./db.js";

const POLL_INTERVAL_MS = 60_000;

// Every poll, checks whether each assigned callsign's holder is currently online in ER:LC
// with that exact Callsign live, and credits them the interval if so. Only counts time from
// when this feature shipped forward — there's no historical playtime data before it.
//
// Also upserts the CAD's live_units cache (BOT_SIDE_INSTRUCTIONS.md #3) on the same pass — this
// loop already fetches the full player list and iterates every assigned callsign, so this is a
// consolidation of what it already computes, not a new poller/new ER:LC API surface.
export function startCallsignDutyTracking() {
  setInterval(async () => {
    const players = await getServerPlayers();
    if (!players) return;

    for (const row of await getAllCallsigns()) {
      const link = await findLinkByDiscordId(row.discord_id);
      const callsignKey = `${row.department}-${row.number}`;

      if (!link) {
        await upsertLiveUnit({
          callsignKey,
          department: row.department,
          number: row.number,
          discordId: row.discord_id,
          robloxUsername: null,
          rank: row.rank,
          onDuty: false,
          postal: null,
          location: null,
        });
        continue;
      }

      const player = players.find(
        (p) => p.Player.split(":")[0].toLowerCase() === link.roblox_username.toLowerCase(),
      );
      const onDuty = !!player && String(player.Callsign ?? "") === String(row.number);

      if (onDuty) {
        await incrementCallsignDuty(row.department, row.number, POLL_INTERVAL_MS / 1000);
      }

      await upsertLiveUnit({
        callsignKey,
        department: row.department,
        number: row.number,
        discordId: row.discord_id,
        robloxUsername: link.roblox_username,
        rank: row.rank,
        onDuty,
        postal: onDuty ? (player?.PostalCode ?? null) : null,
        location:
          onDuty && player?.Location?.LocationX !== undefined && player.Location?.LocationZ !== undefined
            ? `${player.Location.LocationX}, ${player.Location.LocationZ}`
            : null,
      });
    }
  }, POLL_INTERVAL_MS);

  console.log(`[duty] callsign duty tracker started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
}
