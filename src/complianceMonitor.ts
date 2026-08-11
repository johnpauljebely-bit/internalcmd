import { getServerPlayers, forceRespawn, sendPrivateMessage } from "./erlcClient.js";
import { findLinkByRobloxUsername, getCallsignsByDiscordId, upsertLivePlayer } from "./db.js";
import { getGuild } from "./discordBot.js";
import {
  COMPLIANCE_ENFORCEMENT_ENABLED,
  PM_AFTER_LOAD_DELAY_MS,
  SHERIFF_COMPLIANCE_EXEMPT_ROLE_ID,
  TEAM_TO_DEPARTMENT,
} from "./config.js";
import { isCompliant, decideComplianceAction, type ComplianceTrackingState } from "./complianceRules.js";

const POLL_INTERVAL_MS = 30_000;

const tracking = new Map<string, ComplianceTrackingState>();

const NAG_MESSAGE = "Your callsign is invalid for your department — please switch to a valid one.";
const ESCALATION_MESSAGE = "You were reloaded for an invalid callsign — set a valid one before rejoining duty.";
// RCMP/BCHP ("sheriff team") get one message throughout — the same nag is PM'd during the soft
// phase AND again after a hard reload, per the user's explicit "pmed the same message" ask
// (distinct from Delta PD, which keeps its own separate pre-/post-reload wording).
const SHERIFF_CALLSIGN_MESSAGE =
  "Your callsign does not match your assigned CAD callsign — please update it in-game to match.";

// Live Discord role lookups are relatively expensive (an API call per check) so this isn't cached
// across polls — role membership can change at any time and exemption needs to reflect that
// immediately, not on a stale 30s-old snapshot.
async function isExemptFromCompliance(discordId: string): Promise<boolean> {
  try {
    const guild = await getGuild();
    const member = await guild.members.fetch(discordId);
    return member.roles.cache.has(SHERIFF_COMPLIANCE_EXEMPT_ROLE_ID);
  } catch (err) {
    console.error(`[compliance] failed to check exemption role for discord=${discordId}`, err);
    return false;
  }
}

// Per the brief: "once on a valid callsign, Discord nickname becomes [callsign] | [username] —
// same format for every department." `/callsign assign` already does this for the RCMP/BCHP
// admin-assigned flow, but Delta PD callsigns are self-chosen in-game (no bot command involved at
// all) — this is the only place that ever finds out a Delta PD officer picked a valid one, so it's
// the only place that can sync their nickname. Cache avoids re-issuing the same setNickname call
// every 30s poll once it's already correct.
const lastSyncedNickname = new Map<string, string>();

async function syncCompliantNickname(
  link: { discord_id: string; roblox_username: string } | undefined,
  callsign: number,
) {
  if (!link) return;
  const desired = `${callsign} | ${link.roblox_username}`;
  if (lastSyncedNickname.get(link.discord_id) === desired) return;

  // Gated the same way as enforcement, not just as a courtesy — this depends on
  // TEAM_TO_DEPARTMENT's Team-name mapping being correct (unconfirmed, see
  // NEEDS_HUMAN_VERIFICATION.md). A wrong guess there would visibly rewrite a real member's
  // nickname on the live production server, which is exactly the kind of thing to stay cautious
  // about until that mapping's been checked against real Team values.
  if (!COMPLIANCE_ENFORCEMENT_ENABLED) {
    console.log(`[compliance][DRY-RUN] would sync nickname for discord=${link.discord_id} to "${desired}"`);
    return;
  }

  try {
    const guild = await getGuild();
    const member = await guild.members.fetch(link.discord_id);
    if (member.nickname !== desired) {
      await member.setNickname(desired);
      console.log(`[compliance] synced nickname for discord=${link.discord_id} -> "${desired}"`);
    }
    lastSyncedNickname.set(link.discord_id, desired);
  } catch (err) {
    console.error(`[compliance] failed to sync nickname for discord=${link.discord_id}`, err);
  }
}

// DRY-RUN by default (COMPLIANCE_ENFORCEMENT_ENABLED unset/false): computes and logs exactly
// what would happen, but never calls forceRespawn/sendPrivateMessage for real. Two things are
// still unconfirmed against live data even with the state machine fully built:
//   1. TEAM_TO_DEPARTMENT's Team string keys (server has been empty every time it's been polled).
//   2. RELOAD_COMMAND_TEMPLATE / PM_COMMAND_TEMPLATE syntax (brief flags the reload command
//      explicitly as needing live confirmation; the PM command is this codebase's own guess).
// This is also confirmed to be the live "Delta Roleplay" production server, not a scratch one —
// do not flip COMPLIANCE_ENFORCEMENT_ENABLED on until both are verified.
export function startComplianceMonitor() {
  setInterval(async () => {
    const players = await getServerPlayers();
    if (!players || players.length === 0) return;

    const now = Date.now();
    const seenThisPoll = new Set<string>();

    for (const p of players) {
      const username = p.Player.split(":")[0];
      const robloxUserId = p.Player.split(":")[1] ?? null;

      // Broader live-state mirror (BOT_SIDE_INSTRUCTIONS.md #6/#7) — every online player, not just
      // ones whose Team maps to a department. Runs before the department-gated logic below since
      // civilians/unmapped-Team players (who `continue` past that check) still belong here.
      await upsertLivePlayer({
        robloxUsername: username,
        robloxUserId,
        team: p.Team ?? null,
        callsign: p.Callsign ?? null,
        postal: p.PostalCode ?? null,
        locationX: p.Location?.LocationX ?? null,
        locationZ: p.Location?.LocationZ ?? null,
        wantedStars: p.WantedStars ?? null,
      });

      const department = p.Team ? TEAM_TO_DEPARTMENT[p.Team] : undefined;
      if (!department) continue;

      const key = username.toLowerCase();
      const link = await findLinkByRobloxUsername(username);

      // Sheriff team (RCMP/BCHP) exemption role — checked before anything else so exempt members
      // never accumulate tracking state at all.
      if ((department === "rcmp" || department === "bchp") && link && (await isExemptFromCompliance(link.discord_id))) {
        tracking.delete(key);
        continue;
      }

      const numeric = Number(p.Callsign);

      // RCMP/BCHP compliance now means "matches the specific callsign CAD has assigned to you,"
      // not just "any number in your rank's valid range" — pull their actual assigned numbers for
      // this department. An unlinked sheriff-team player has no CAD record we can check against,
      // so they're always non-compliant (empty array never matches) rather than falling back to
      // the old range check, which is exactly the gap this change closes.
      const assignedNumbers =
        department === "delta-pd"
          ? undefined
          : link
            ? (await getCallsignsByDiscordId(link.discord_id)).filter((c) => c.department === department).map((c) => c.number)
            : [];

      const compliant = Number.isFinite(numeric) && isCompliant(department, numeric, assignedNumbers);

      if (compliant) {
        tracking.delete(key);
        await syncCompliantNickname(link, numeric);
        continue;
      }

      seenThisPoll.add(key);
      let state = tracking.get(key);
      if (!state) {
        state = { firstNonCompliantAt: now, lastPmAt: null, lastLoadAt: null };
        tracking.set(key, state);
      }

      const action = decideComplianceAction(department, state, now);
      if (action.type === "none") continue;

      const label = `${username} (${link ? `linked discord=${link.discord_id}` : "not linked"}) on ${department}, callsign "${p.Callsign}"`;

      if (!COMPLIANCE_ENFORCEMENT_ENABLED) {
        console.warn(`[compliance][DRY-RUN] ${label} — would ${action.type} (${action.reason}). No action taken.`);
        // Still advance the timers so dry-run logs reflect realistic cadence over time.
        if (action.type === "pm") state.lastPmAt = now;
        if (action.type === "load-then-pm") state.lastLoadAt = now;
        continue;
      }

      const isSheriff = department === "rcmp" || department === "bchp";

      if (action.type === "pm") {
        console.log(`[compliance] PMing ${label} (${action.reason})`);
        await sendPrivateMessage(username, isSheriff ? SHERIFF_CALLSIGN_MESSAGE : NAG_MESSAGE);
        state.lastPmAt = now;
      } else {
        console.log(`[compliance] force-respawning ${label} (${action.reason})`);
        await forceRespawn(username);
        state.lastLoadAt = now;
        setTimeout(async () => {
          await sendPrivateMessage(username, isSheriff ? SHERIFF_CALLSIGN_MESSAGE : ESCALATION_MESSAGE);
        }, PM_AFTER_LOAD_DELAY_MS);
      }
    }

    // Drop tracking for anyone who's no longer online/non-compliant this poll and wasn't
    // touched above (e.g. they left the server).
    for (const key of tracking.keys()) {
      if (!seenThisPoll.has(key)) tracking.delete(key);
    }
  }, POLL_INTERVAL_MS);

  console.log(
    `[compliance] monitor started, enforcement=${COMPLIANCE_ENFORCEMENT_ENABLED ? "LIVE" : "DRY-RUN"} ` +
      `(polling every ${POLL_INTERVAL_MS / 1000}s)`,
  );
}
