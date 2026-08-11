import {
  CALLSIGN_RANGES,
  DELTA_PD_CALLSIGN_RANGE,
  DELTA_PD_ESCALATION_THRESHOLD_MS,
  DELTA_PD_SOFT_NAG_INTERVAL_MS,
  ENFORCEMENT_REPEAT_INTERVAL_MS,
  SHERIFF_HARD_REPEAT_INTERVAL_MS,
  type Department,
} from "./config.js";

// `assignedNumbers`, when provided, is the specific set of callsign numbers CAD has on record
// for this person in this department (from the shared `callsigns` table) — used for RCMP/BCHP so
// compliance means "matches what's actually assigned to you," not just "any number in the valid
// range for your rank." Delta PD has no CAD-assigned number (self-chosen in-game), so it keeps
// the range check regardless of this argument. When omitted (or the person isn't linked, so we
// have no CAD record to check against at all), non-delta-pd departments fall back to the range
// check — see complianceMonitor.ts for how it decides which to pass.
export function isCompliant(department: Department, callsignNumber: number, assignedNumbers?: number[]): boolean {
  if (department === "delta-pd") {
    return callsignNumber >= DELTA_PD_CALLSIGN_RANGE.min && callsignNumber <= DELTA_PD_CALLSIGN_RANGE.max;
  }
  if (assignedNumbers !== undefined) {
    return assignedNumbers.includes(callsignNumber);
  }
  return CALLSIGN_RANGES[department].some((r) => callsignNumber >= r.min && callsignNumber <= r.max);
}

export interface ComplianceTrackingState {
  firstNonCompliantAt: number;
  lastPmAt: number | null;
  lastLoadAt: number | null;
}

export type ComplianceAction =
  | { type: "none" }
  | { type: "pm"; reason: string }
  | { type: "load-then-pm"; reason: string };

// Pure decision function — given how long a player has been non-compliant and when they were
// last nagged/reloaded, decides what (if anything) should happen right now. Kept separate from
// polling/IO so it's unit-testable without a live server.
//
// As of 2026-08-11, RCMP/BCHP ("sheriff team") share Delta PD's exact grace-period shape (2min
// soft PM until 6min elapsed) instead of the old "no grace period, immediate hard enforcement" —
// the only remaining difference is the repeat cadence once past the threshold: Delta PD repeats
// every 2min, sheriff team every 1min.
export function decideComplianceAction(
  department: Department,
  state: ComplianceTrackingState,
  now: number,
): ComplianceAction {
  const elapsed = now - state.firstNonCompliantAt;

  if (elapsed < DELTA_PD_ESCALATION_THRESHOLD_MS) {
    const dueForNag = state.lastPmAt === null || now - state.lastPmAt >= DELTA_PD_SOFT_NAG_INTERVAL_MS;
    return dueForNag ? { type: "pm", reason: "soft nag (grace period)" } : { type: "none" };
  }

  const repeatInterval = department === "delta-pd" ? ENFORCEMENT_REPEAT_INTERVAL_MS : SHERIFF_HARD_REPEAT_INTERVAL_MS;
  const dueForEscalation = state.lastLoadAt === null || now - state.lastLoadAt >= repeatInterval;
  return dueForEscalation ? { type: "load-then-pm", reason: "hard escalation (past 6min)" } : { type: "none" };
}
