import { announceToRTO } from "./discordBot.js";
import { getServerPlayers, announcePA } from "./erlcClient.js";
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

// Consulted by the voice pipeline to suppress STT/response handling in RTO while a pursuit is
// active (see voiceSession.ts's handleUtterance).
export function isPursuitActive(): boolean {
  return state.active;
}

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

// Same wording spoken and posted/PA'd, except callsign/postal get NATO-digit speech formatting
// for the voice channel only (confirmed live elsewhere this session: Piper reads a whole number
// like "1247" as "twelve forty-seven," not digit-by-digit — text/PA stay literal since those are
// read, not heard).
async function announceEverywhere(build: (fmt: (v: string) => string) => string) {
  const textAndPa = build((v) => v);
  const spoken = build(formatForSpeech);
  await Promise.all([announceToRTO(textAndPa), announcePA(textAndPa), announceToActiveDispatcher(spoken)]);
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
