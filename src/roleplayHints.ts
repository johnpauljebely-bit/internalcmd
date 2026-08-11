import { announcePA } from "./erlcClient.js";
import { ROLEPLAY_HINT_INTERVAL_MS } from "./config.js";

// The user named two example categories ("GTA driving," "liveries") and said "and more" — this
// list covers those two plus other common ER:LC roleplay-quality issues. Wording beyond the two
// named examples is this codebase's own inference, not something the user dictated verbatim —
// flagged in NEEDS_HUMAN_VERIFICATION.md for review/expansion.
const HINTS = [
  "Drive realistically, not GTA-style — stay in your lane, obey traffic laws, and drive like your character actually has a license.",
  "Make sure your vehicle livery matches your department and rank — a mismatched livery breaks immersion for everyone around you.",
  "Stay in character while in-game — take out-of-character chatter to Discord.",
  "Use your turn signals and come to a full stop at red lights and stop signs unless you're responding Code 3.",
  "Avoid powergaming — give others a fair chance to roleplay their own actions instead of forcing an outcome on them.",
  "Avoid metagaming — don't let out-of-character information (like Discord chatter) influence your in-character decisions.",
  "Keep radio traffic professional and use proper 10-codes where you can.",
  "Park considerately during scenes — don't block roads or other players unnecessarily.",
];

function randomHint(): string {
  return HINTS[Math.floor(Math.random() * HINTS.length)];
}

// General server-wide roleplay-quality PSA — deliberately PA-only, not spoken through the active
// voice dispatcher. Dispatch radio is reserved for LEO-operational traffic (calls, BOLOs,
// pursuits); a "remember your turn signals" reminder doesn't belong on that channel.
export function startRoleplayHints() {
  setInterval(async () => {
    await announcePA(randomHint());
  }, ROLEPLAY_HINT_INTERVAL_MS);

  console.log(`[roleplay-hints] started, broadcasting every ${ROLEPLAY_HINT_INTERVAL_MS / 60_000}min`);
}
