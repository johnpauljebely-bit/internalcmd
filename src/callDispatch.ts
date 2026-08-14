import { getServerCalls, type ErlcCall } from "./erlcClient.js";
import { findNearestUnit } from "./nearestUnit.js";
import { announceToRTO } from "./discordBot.js";
import { announcePA } from "./erlcClient.js";
import { announceToActiveDispatcher } from "./voice/activeDispatcherRegistry.js";
import { recordNewCall, markCallCleared, getActiveCalls, type CallRow } from "./db.js";
import { formatForSpeech } from "./speechFormat.js";

const POLL_INTERVAL_MS = 15_000;

let knownCallIds = new Set<string>();
let firstPoll = true;

function callId(call: ErlcCall): string {
  return call.CallNumber ?? JSON.stringify(call);
}

// Position's real shape has never been observed (no live call has happened yet) — this tries
// several plausible layouts rather than assuming one. A 3-part string is assumed to be
// "x, y, z" (dropping y) to match Location.LocationX/LocationZ's convention elsewhere.
export function extractXZ(position: unknown): { x: number; z: number } | null {
  if (position == null) return null;

  if (typeof position === "object") {
    const obj = position as Record<string, unknown>;
    const x = obj.x ?? obj.X ?? obj.LocationX;
    const z = obj.z ?? obj.Z ?? obj.LocationZ;
    if (typeof x === "number" && typeof z === "number") return { x, z };
    return null;
  }

  if (typeof position === "string") {
    const parts = position.split(",").map((s) => Number(s.trim()));
    if (parts.length === 3 && parts.every(Number.isFinite)) return { x: parts[0], z: parts[2] };
    if (parts.length === 2 && parts.every(Number.isFinite)) return { x: parts[0], z: parts[1] };
  }

  return null;
}

// Best-effort — ErlcCall has no postal field of its own (unconfirmed shape, no live call
// observed), so this approximates using the nearest unit's own postal. Flagged, not hidden.
async function approximatePostal(call: ErlcCall): Promise<string> {
  const xz = extractXZ(call.Position);
  if (!xz) return "unknown";
  const nearest = await findNearestUnit(xz.x, xz.z, call.Team ? { team: call.Team } : {});
  return nearest?.player.PostalCode ?? "unknown";
}

async function announceNewCall(call: ErlcCall) {
  const id = callId(call);
  const description = call.Description ?? "unknown activity";
  const postal = await approximatePostal(call);

  await recordNewCall(id, description, call.Team ?? null, postal);

  const xz = extractXZ(call.Position);
  let nearestLine = "";
  if (xz) {
    const nearest = await findNearestUnit(xz.x, xz.z, call.Team ? { team: call.Team } : {});
    if (nearest) {
      const username = nearest.player.Player.split(":")[0];
      nearestLine = ` Nearest unit: ${nearest.player.Callsign ?? username} (~${Math.round(nearest.distance)} studs away).`;
    }
  }

  const textAnnouncement = `New call #${call.CallNumber ?? "?"}${call.Team ? ` (${call.Team})` : ""}: ${description}.${nearestLine}`;

  // Spoken/PA phrasing per request: "all units be advised, active {crime} at postal {postal}."
  // Case number appended so officers actually have something to reference when attaching by
  // case number later ("attach me to case #X") — id IS the case number (from CallNumber).
  const spokenAnnouncement = `all units be advised, active ${description} at postal ${formatForSpeech(postal)}, case number ${formatForSpeech(id)}.`;

  await Promise.all([
    announceToRTO(textAnnouncement),
    announcePA(spokenAnnouncement),
    announceToActiveDispatcher(spokenAnnouncement),
  ]);
}

// Officers attach to a call by describing it in speech (e.g. "attach to the robbery") — matches
// against currently active calls' descriptions. Falls back to "the one active call" if there's
// exactly one and the description doesn't match anything (handles a vague "attach to that").
export async function findActiveCallByText(query: string): Promise<CallRow | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const active = await getActiveCalls();
  const match = active.find(
    (c) => c.description && (c.description.toLowerCase().includes(q) || q.includes(c.description.toLowerCase())),
  );
  if (match) return match;

  return active.length === 1 ? active[0] : null;
}

// Exact match by case number — more reliable than description-text fuzzy matching, and how
// "attach me to case #X" is meant to work. The call's id IS its case number (from CallNumber).
export async function findActiveCallByCaseNumber(caseNumber: string): Promise<CallRow | null> {
  const active = await getActiveCalls();
  return active.find((c) => c.id === caseNumber) ?? null;
}

// For "show me enroute to the call at postal X" — a third way to identify which call, alongside
// description and case number.
export async function findActiveCallByPostal(postal: string): Promise<CallRow | null> {
  const active = await getActiveCalls();
  return active.find((c) => c.postal === postal) ?? null;
}

// For when dispatch has no record of what's being reported (e.g. "attach me to the panic at
// postal X" with nothing on file) — the reporting officer's own transmission becomes the call
// record instead of dispatch drawing a blank. Real scenario this solves: ER:LC panic events have
// never been confirmed to even exist as a webhook event (see NEEDS_HUMAN_VERIFICATION.md), so
// waiting on that to eventually arrive isn't a real fix — this works regardless of whether ER:LC
// ever sends one. source='leo' distinguishes it from ER:LC-sourced ('erlc_native') and
// CAD-originated ('caller') calls. Broadcasts to RTO text + in-game PA, same as a normal new-call
// announcement — deliberately NOT also spoken through the voice dispatcher here, since the caller
// is that same voice session and is about to hear a direct response; speaking both back-to-back on
// the same audio player would collide/cut off.
export async function declareCallFromVoice(description: string, postal: string, reportedByDiscordId: string): Promise<CallRow> {
  const active = await getActiveCalls();
  const taken = new Set(active.map((c) => c.id));
  let id: string;
  do {
    id = String(Math.floor(1000 + Math.random() * 9000));
  } while (taken.has(id));

  // CAD sets type='panic' on its own button-pressed panic calls for board categorization
  // (priority/styling keys off `type`) — per COORDINATION.md 2026-08-11, self-declared voice
  // reports should match that so a voice-reported panic gets the same board treatment. The
  // description is the officer's own spoken words ("the panic"), so a substring match is the
  // same signal a human reading it would use.
  const type = /\bpanic\b/i.test(description) ? "panic" : null;
  await recordNewCall(id, description, null, postal, "leo", type);

  await Promise.all([
    announceToRTO(`New call #${id} (reported by <@${reportedByDiscordId}>): ${description} at postal ${postal}.`),
    announcePA(`all units be advised, active ${description} at postal ${formatForSpeech(postal)}, case number ${formatForSpeech(id)}.`),
  ]);

  return { id, description, team: null, postal, created_at: new Date().toISOString(), cleared_at: null };
}

// Polls calls independently of the webhook — this doesn't depend on ER:LC ever delivering a
// webhook event, only on the plain REST endpoint. First poll after startup just baselines the
// known call list (doesn't announce pre-existing calls as "new").
export function startCallDispatch() {
  setInterval(async () => {
    const calls = await getServerCalls();
    if (!calls) return;

    const currentIds = new Set(calls.map(callId));

    if (!firstPoll) {
      for (const call of calls) {
        if (!knownCallIds.has(callId(call))) await announceNewCall(call);
      }
      for (const id of knownCallIds) {
        if (!currentIds.has(id)) {
          await markCallCleared(id);
          // Same three channels as a new-call announcement, for consistency — text/PA keep the
          // literal case number since those are read, not heard; voice gets it spoken digit-by-
          // digit like every other spoken number in this pipeline.
          await Promise.all([
            announceToRTO(`Call cleared: #${id}`),
            announcePA(`Call cleared, case number ${id}.`),
            announceToActiveDispatcher(`Call cleared, case number ${formatForSpeech(id)}.`),
          ]);
        }
      }
    }

    knownCallIds = currentIds;
    firstPoll = false;
  }, POLL_INTERVAL_MS);

  console.log(
    `[calls] dispatch monitor started (polling every ${POLL_INTERVAL_MS / 1000}s) — ` +
      "call Position field shape is unconfirmed, nearest-unit line may be missing/wrong until verified live",
  );
}
