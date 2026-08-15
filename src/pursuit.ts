import { announceToRTO } from "./discordBot.js";
import { getServerPlayers } from "./erlcClient.js";
import { announceToActiveDispatcher } from "./voice/activeDispatcherRegistry.js";
import { findLinkByRobloxUserId, getCallsignsByDiscordId } from "./db.js";
import { formatForSpeech } from "./speechFormat.js";

interface PursuitState {
  active: boolean;
  officerRobloxId: string;
  vehicleDescription: string;
  intervalHandle: ReturnType<typeof setInterval> | null;
}

const state: PursuitState = {
  active: false,
  officerRobloxId: "",
  vehicleDescription: "",
  intervalHandle: null,
};

async function currentCallsignAndPostal(robloxUserId: string): Promise<{ callsign: string; postal: string }> {
  const players = await getServerPlayers();
  const player = players?.find((p) => p.Player.split(":")[1] === robloxUserId);

  // Prefer OUR assigned callsign (the same source of truth the voice dispatcher trusts — see
  // resolveCallsign in voiceSession.ts) over ER:LC's own live "Callsign" player field, which for
  // RCMP/BCHP is whatever the player typed in-game and may not match what they were actually
  // assigned via /callsign assign. Falls back to the live field, then "unknown".
  const link = await findLinkByRobloxUserId(robloxUserId);
  const assigned = link ? (await getCallsignsByDiscordId(link.discord_id))[0]?.number : undefined;

  return {
    callsign: assigned !== undefined ? String(assigned) : (player?.Callsign ?? "unknown"),
    postal: player?.PostalCode ?? "unknown",
  };
}

// Same wording posted and spoken, except callsign/postal get NATO-digit speech formatting for the
// voice channel only (confirmed live elsewhere this session: Piper reads a whole number like
// "1247" as "twelve forty-seven," not digit-by-digit — text stays literal since that's read, not
// heard).
//
// 2026-08-14: no longer sent through ER:LC's in-game :h PA — per explicit user request, dispatch/
// police radio traffic (pursuits, calls, BOLOs, panics) should stay on Discord (text + voice) only,
// since :h broadcasts to every player in the server including civilians. Only genuinely
// server-wide messages (session start/shutdown, in commands/session.ts) still use PA.
async function announceEverywhere(build: (fmt: (v: string) => string) => string) {
  const text = build((v) => v);
  const spoken = build(formatForSpeech);
  await Promise.all([announceToRTO(text), announceToActiveDispatcher(spoken)]);
}

export async function startPursuit(officerRobloxId: string, vehicleDescription: string) {
  if (state.active) return;

  state.active = true;
  state.officerRobloxId = officerRobloxId;
  state.vehicleDescription = vehicleDescription;

  const { callsign, postal } = await currentCallsignAndPostal(officerRobloxId);
  // Goes through Roblox's chat filter via virtual server management — per the brief, test this
  // exact phrasing in-game early since filtering can silently alter or block it.
  await announceEverywhere(
    (fmt) =>
      `all units hold traffic, active pursuit, officer ${fmt(callsign)} pursuing ${vehicleDescription}, current postal is ${fmt(postal)}, all available units respond.`,
  );

  state.intervalHandle = setInterval(async () => {
    if (!state.active) return;
    const { postal: updatedPostal } = await currentCallsignAndPostal(officerRobloxId);
    await announceEverywhere((fmt) => `Pursuit update — current postal is ${fmt(updatedPostal)}.`);
  }, 7000);
}

export async function endPursuit() {
  if (!state.active) return;

  if (state.intervalHandle) clearInterval(state.intervalHandle);
  state.intervalHandle = null;
  state.active = false;
  state.officerRobloxId = "";
  state.vehicleDescription = "";

  await announceEverywhere(() => "Pursuit is over, all units return 10-8, suspect down.");
}
