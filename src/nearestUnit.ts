import { getServerPlayers, type ErlcPlayer } from "./erlcClient.js";
import { findLinkByRobloxUsername } from "./db.js";
import { distance2D } from "./distance.js";

export interface NearestUnitResult {
  player: ErlcPlayer;
  discordId: string | null;
  distance: number;
}

// Distance is computed off live Location.LocationX/LocationZ, not postal codes directly —
// we have no postal-code-to-coordinate map, and this reuses the same field ;ts/;scene already
// rely on. Postal code is still what gets read out to officers (from the player's own
// PostalCode field), matching how dispatch narration is described in the brief.
export async function findNearestUnit(
  targetX: number,
  targetZ: number,
  opts: { team?: string; excludeRobloxId?: string } = {},
): Promise<NearestUnitResult | null> {
  const players = await getServerPlayers();
  if (!players) return null;

  let best: NearestUnitResult | null = null;
  for (const p of players) {
    if (opts.team && p.Team?.toLowerCase() !== opts.team.toLowerCase()) continue;
    if (opts.excludeRobloxId && p.Player.split(":")[1] === opts.excludeRobloxId) continue;
    const x = p.Location?.LocationX;
    const z = p.Location?.LocationZ;
    if (x === undefined || z === undefined) continue;

    const distance = distance2D(x, z, targetX, targetZ);
    if (!best || distance < best.distance) {
      const username = p.Player.split(":")[0];
      const link = await findLinkByRobloxUsername(username);
      best = { player: p, discordId: link?.discord_id ?? null, distance };
    }
  }
  return best;
}
