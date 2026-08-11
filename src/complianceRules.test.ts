import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompliant, decideComplianceAction, type ComplianceTrackingState } from "./complianceRules.js";
import {
  DELTA_PD_ESCALATION_THRESHOLD_MS,
  DELTA_PD_SOFT_NAG_INTERVAL_MS,
  ENFORCEMENT_REPEAT_INTERVAL_MS,
  SHERIFF_HARD_REPEAT_INTERVAL_MS,
} from "./config.js";

test("isCompliant — Delta PD range", () => {
  assert.equal(isCompliant("delta-pd", 400), true);
  assert.equal(isCompliant("delta-pd", 499), true);
  assert.equal(isCompliant("delta-pd", 399), false);
  assert.equal(isCompliant("delta-pd", 500), false);
});

test("isCompliant — RCMP spans multiple non-overlapping rank ranges", () => {
  assert.equal(isCompliant("rcmp", 1450), true); // constable
  assert.equal(isCompliant("rcmp", 1025), true); // superintendent
  assert.equal(isCompliant("rcmp", 1075), true); // commissioner
  assert.equal(isCompliant("rcmp", 1500), false); // above every range
  assert.equal(isCompliant("rcmp", 1050), true); // commissioner floor, adjacent to superintendent's 1049 ceiling
  assert.equal(isCompliant("rcmp", 1049), true); // superintendent ceiling
});

test("isCompliant — BCHP resolved ranges don't overlap", () => {
  assert.equal(isCompliant("bchp", 2125), true); // inspector
  assert.equal(isCompliant("bchp", 2175), true); // staff-sergeant
  assert.equal(isCompliant("bchp", 2149), true); // inspector ceiling
  assert.equal(isCompliant("bchp", 2150), true); // staff-sergeant floor — adjacent, not overlapping
  assert.equal(isCompliant("bchp", 3000), false);
});

test("decideComplianceAction — Delta PD nags on first detection", () => {
  const now = 1_000_000;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: null, lastLoadAt: null };
  assert.deepEqual(decideComplianceAction("delta-pd", state, now), { type: "pm", reason: "soft nag (grace period)" });
});

test("decideComplianceAction — Delta PD doesn't re-nag before the 2min interval", () => {
  const now = 1_000_000;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: now, lastLoadAt: null };
  const later = now + DELTA_PD_SOFT_NAG_INTERVAL_MS - 1;
  assert.deepEqual(decideComplianceAction("delta-pd", state, later), { type: "none" });
});

test("decideComplianceAction — Delta PD re-nags once the 2min interval elapses", () => {
  const now = 1_000_000;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: now, lastLoadAt: null };
  const later = now + DELTA_PD_SOFT_NAG_INTERVAL_MS;
  assert.equal(decideComplianceAction("delta-pd", state, later).type, "pm");
});

test("decideComplianceAction — Delta PD escalates to load-then-pm past 6min", () => {
  const now = 1_000_000;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: now, lastLoadAt: null };
  const later = now + DELTA_PD_ESCALATION_THRESHOLD_MS;
  assert.equal(decideComplianceAction("delta-pd", state, later).type, "load-then-pm");
});

test("decideComplianceAction — Delta PD escalation repeats every 2min, not more often", () => {
  const now = 1_000_000;
  const escalatedAt = now + DELTA_PD_ESCALATION_THRESHOLD_MS;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: now, lastLoadAt: escalatedAt };

  assert.equal(decideComplianceAction("delta-pd", state, escalatedAt + 1000).type, "none");
  assert.equal(
    decideComplianceAction("delta-pd", state, escalatedAt + ENFORCEMENT_REPEAT_INTERVAL_MS).type,
    "load-then-pm",
  );
});

// 2026-08-11: RCMP/BCHP now share Delta PD's exact grace-period shape (2min soft PM until 6min
// elapsed) instead of enforcing immediately — the only remaining difference is a faster 1min
// hard-repeat cadence once past the threshold, vs. Delta PD's 2min.
test("decideComplianceAction — RCMP/BCHP now get the same 2min soft-nag grace period as Delta PD, not immediate enforcement", () => {
  const now = 1_000_000;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: null, lastLoadAt: null };
  assert.equal(decideComplianceAction("rcmp", state, now).type, "pm");
  assert.equal(decideComplianceAction("bchp", state, now).type, "pm");
});

test("decideComplianceAction — RCMP/BCHP escalates to load-then-pm past 6min, same threshold as Delta PD", () => {
  const now = 1_000_000;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: now, lastLoadAt: null };
  const later = now + DELTA_PD_ESCALATION_THRESHOLD_MS;
  assert.equal(decideComplianceAction("rcmp", state, later).type, "load-then-pm");
  assert.equal(decideComplianceAction("bchp", state, later).type, "load-then-pm");
});

test("decideComplianceAction — RCMP/BCHP hard-escalation repeats every 1min, faster than Delta PD's 2min", () => {
  const now = 1_000_000;
  const escalatedAt = now + DELTA_PD_ESCALATION_THRESHOLD_MS;
  const state: ComplianceTrackingState = { firstNonCompliantAt: now, lastPmAt: now, lastLoadAt: escalatedAt };

  assert.equal(decideComplianceAction("rcmp", state, escalatedAt + 1000).type, "none");
  assert.equal(
    decideComplianceAction("rcmp", state, escalatedAt + SHERIFF_HARD_REPEAT_INTERVAL_MS).type,
    "load-then-pm",
  );
  // Confirms the new interval is genuinely faster than Delta PD's, not just a renamed constant.
  assert.ok(SHERIFF_HARD_REPEAT_INTERVAL_MS < ENFORCEMENT_REPEAT_INTERVAL_MS);
});

test("isCompliant — RCMP/BCHP with assignedNumbers checks the exact assigned callsign, not just range membership", () => {
  // In-range but NOT their assigned number — no longer compliant, this is the whole point of #4.
  assert.equal(isCompliant("rcmp", 1450, [1451]), false);
  assert.equal(isCompliant("rcmp", 1451, [1451]), true);
  // No CAD record at all (unlinked, or no callsign assigned in this department) — never compliant.
  assert.equal(isCompliant("rcmp", 1450, []), false);
});

test("isCompliant — Delta PD ignores assignedNumbers, always uses the range check", () => {
  assert.equal(isCompliant("delta-pd", 450, []), true);
  assert.equal(isCompliant("delta-pd", 450, [999]), true);
});
