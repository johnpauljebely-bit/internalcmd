export const GUILD_ID = "1535866581316276256";

// Multiple numbered instances of each VC exist in Discord — bot picks the first empty one per drag.
export const STAFF_SCENE_VC_IDS = [
  "1535866586924326963",
  "1535866586924326964",
  "1535866586924326965",
  "1535866586924326966",
  "1535866586924326968",
];

export const TRAFFIC_STOP_VC_IDS = [
  "1535866586077069447",
  "1535866586077069448",
  "1535866586077069449",
  "1535866586077069450",
  "1535866586077069451",
];

export const SCENE_VC_IDS = [
  "1535866586299240469",
  "1535866586299240470",
  "1535866586299240471",
  "1535866586299240472",
  "1535866586299240473",
];

// "Law Enforcement Radio" — confirmed as the RTO channel for pursuit/panic announcements.
// Also used as the ;team fallback target: no per-department VC exists yet (only one
// "Divisional Only (CH:1)" channel, not one per department) — revisit once real
// per-department VCs exist.
export const RTO_CHANNEL_ID = "1535866585779277862";

// 「🧰」server-management — every ;verify attempt (success or failure) is logged here.
export const SERVER_MANAGEMENT_CHANNEL_ID = "1535866584290304070";

export const COMMUNITY_DIRECTIVE_ROLE_ID = "1535866581891026948";

// Stand-in for "top 2 ranks" of a department, since no RCMP/BCHP/Delta rank roles exist
// yet in Discord. Confirmed by user: any Directive, Executive-tier, or Whitelisted Command
// role holder can run /callsign. Revisit once real department rank roles are created.
export const CALLSIGN_ADMIN_ROLE_IDS = [
  COMMUNITY_DIRECTIVE_ROLE_ID, // Community Directive
  "1535866581891026945", // Executive Team
  "1535866581891026944", // Lead Executive
  "1535866581874376765", // Senior Executive
  "1535866581874376764", // Executive
  "1535866581823922236", // Whitelisted Command
];

// /dispatch enable|disable permission — Directors, Executive-tier, and Managers. Deliberately a
// different set from CALLSIGN_ADMIN_ROLE_IDS (no Whitelisted Command, adds Management tier).
export const DISPATCH_ADMIN_ROLE_IDS = [
  "1535866581891026948", // Community Directive
  "1535866581891026945", // Executive Team
  "1535866581891026944", // Lead Executive
  "1535866581874376765", // Senior Executive
  "1535866581874376764", // Executive
  "1535866581874376763", // Management Team
  "1535866581874376762", // Senior Manager
  "1535866581874376761", // Manager
];

export const DRAG_COMMAND_COOLDOWN_MS = 7000;

// Confirmed by the user 2026-08-11 — `;mod` in-game drags the caller here. Auto-resolved (no
// manual confirm command) by `modCallDetector.ts` watching the ER:LC command log for a staff
// member's own `:tp` command targeting the waiting player. The other half of the flow —
// "available mod scene" — reuses the existing STAFF_SCENE_VC_IDS pool below, since `;ss` already
// does exactly "drag into first empty staff scene channel."
export const STAFF_WAITING_ROOM_VC_ID = "1535866586924326962";

// Distance (in ER:LC world studs, using Location.LocationX/LocationZ) within which ;ts and
// ;scene pull other linked players in. Untested guess — tune once verified in-game on the
// scratch server per the brief's own testing guardrail.
export const PROXIMITY_STUDS = Number(process.env.ERLC_PROXIMITY_STUDS ?? 60);

// "ownership" isn't a real department — it's a cross-department executive-tier callsign
// (100-199) for Community Directive role holders, orthogonal to whatever RCMP/BCHP/Delta PD
// callsign someone might separately hold. Modeled as a pseudo-department so it reuses the same
// admin-assign/range-validation machinery as RCMP/BCHP rather than a parallel code path.
export type Department = "delta-pd" | "rcmp" | "bchp" | "ownership";

export interface RankRange {
  rank: string;
  min: number;
  max: number;
}

// Delta PD is unwhitelisted and self-assigns within 400-499 (not auto-assigned by /callsign).
export const CALLSIGN_RANGES: Record<Exclude<Department, "delta-pd">, RankRange[]> = {
  rcmp: [
    { rank: "constable", min: 1400, max: 1499 },
    { rank: "corporal", min: 1300, max: 1399 },
    { rank: "sergeant", min: 1200, max: 1299 },
    { rank: "inspector", min: 1100, max: 1199 },
    { rank: "superintendent", min: 1000, max: 1049 },
    { rank: "commissioner", min: 1050, max: 1099 },
  ],
  bchp: [
    { rank: "constable", min: 2400, max: 2499 },
    { rank: "corporal", min: 2300, max: 2399 },
    { rank: "sergeant", min: 2200, max: 2299 },
    { rank: "staff-sergeant", min: 2150, max: 2199 },
    { rank: "inspector", min: 2100, max: 2149 },
    { rank: "chief-superintendent", min: 2050, max: 2099 },
    { rank: "superintendent", min: 2000, max: 2049 },
  ],
  // Single rank, single range — target must already hold the Community Directive role (checked
  // in commands/callsign.ts, not here, since role membership needs a live Discord API call).
  ownership: [{ rank: "ownership", min: 100, max: 199 }],
};

export const DELTA_PD_CALLSIGN_RANGE = { min: 400, max: 499 };

// UNCONFIRMED — no player has ever been observed live via /v2/server?Players=true (server was
// empty every time it was queried), so these Team string guesses have not been checked against
// real data. Calibrate against logs once players are online.
export const TEAM_TO_DEPARTMENT: Record<string, Department> = {
  "Delta Police Department": "delta-pd",
  RCMP: "rcmp",
  BCHP: "bchp",
};

// Master switch for compliance enforcement actually taking live action (force-respawn + PM).
// Defaults OFF — flip only after TEAM_TO_DEPARTMENT and the command templates below are
// confirmed against real gameplay. While off, the monitor still runs and logs what it would do.
export const COMPLIANCE_ENFORCEMENT_ENABLED = process.env.COMPLIANCE_ENFORCEMENT_ENABLED === "true";

// UNCONFIRMED — the brief itself flags the force-respawn command as needing live confirmation
// ("confirm exact ER:LC staff command during Phase 1 testing"); the PM command is an even
// rougher guess since the brief never names it. {username}/{message} get substituted.
// Override via env once the real syntax is known.
export const RELOAD_COMMAND_TEMPLATE = process.env.ERLC_RELOAD_COMMAND_TEMPLATE ?? ":load {username}";
export const PM_COMMAND_TEMPLATE = process.env.ERLC_PM_COMMAND_TEMPLATE ?? ":pm {username} {message}";

export const DELTA_PD_SOFT_NAG_INTERVAL_MS = 2 * 60_000;
export const DELTA_PD_ESCALATION_THRESHOLD_MS = 6 * 60_000;
export const ENFORCEMENT_REPEAT_INTERVAL_MS = 2 * 60_000;
export const PM_AFTER_LOAD_DELAY_MS = 3_000;

// RCMP/BCHP ("sheriff team") now share Delta PD's exact grace-period timing (2min soft PM until
// 6min elapsed) per the user's 2026-08-11 ask, but their hard-escalation repeats every 1min once
// past the threshold, not 2min — a deliberately faster cadence than Delta PD's.
export const SHERIFF_HARD_REPEAT_INTERVAL_MS = 60_000;

// Sheriff team (RCMP/BCHP) holders of this role are fully exempt from callsign compliance
// enforcement — no soft nags, no reloads, no exact-callsign-match checks. Confirmed by user
// 2026-08-11.
export const SHERIFF_COMPLIANCE_EXEMPT_ROLE_ID = "1535866581853413383";

// In-game join code non-linked players are reminded of every 3 minutes (BOT_SIDE user ask,
// 2026-08-11) — this is the exact code the user provided, not a placeholder.
export const DISCORD_JOIN_CODE = "ZMKNFxzNTX";
export const JOIN_REMINDER_INTERVAL_MS = 3 * 60_000;

export const ROLEPLAY_HINT_INTERVAL_MS = 7 * 60_000;

// On-duty LEO (Team maps to a department) who are linked but not currently active on the CAD
// dashboard get PM'd every 2 minutes (user ask, 2026-08-14). "Active" means `cad_activity.
// last_seen_at` within this staleness window — set a bit above the reminder interval itself as
// buffer for normal heartbeat jitter, assuming the CAD pings at least every ~1-2min while a tab
// is open. Depends on the CAD side actually writing to `cad_activity` — proposed via
// COORDINATION.md, not yet confirmed as built on their end.
export const CAD_REMINDER_INTERVAL_MS = 2 * 60_000;
export const CAD_ACTIVITY_STALE_MS = 3 * 60_000;

// Session system (user ask, 2026-08-14) — the channel every session panel/vote/start-up embed
// gets posted to, and the role pinged for session votes + subscribed to via the shutdown
// notification button.
export const SESSION_CHANNEL_ID = "1535866584604872775";
export const SESSION_PING_ROLE_ID = "1535866581761138805";

// "Management Team or higher" for /sessionstart and /sessiondown — reuses DISPATCH_ADMIN_ROLE_IDS'
// existing ordering (Community Directive down to Manager) sliced at Management Team, since that
// list already encodes this exact hierarchy. /sessionpanel uses the same tier — no separate role
// was specified for it, and it's thematically the same admin surface.
export const SESSION_ADMIN_ROLE_IDS = DISPATCH_ADMIN_ROLE_IDS.slice(0, 6);

export const SESSION_JOIN_CODE = "playdelta";
export const SESSION_SERVER_OWNER = "clearly_jp";

// UNCONFIRMED — these are Discord CDN attachment URLs with signed, EXPIRING query params
// (`ex=`/`is=`/`hm=`). They'll work today but the signature will eventually expire and the images
// will stop loading — flagged in NEEDS_HUMAN_VERIFICATION.md. Re-upload as permanent bot-hosted
// assets (or re-fetch fresh URLs) once that happens.
export const SESSION_BANNER_URL =
  "https://media.discordapp.net/attachments/1535866584290304072/1538028240994836491/Copy_of_Banners_2.png?ex=6a812feb&is=6a7fde6b&hm=826a9d2375a35d50219f4373a5c19fc839613e22e44ae39ecd9dcc73bfabdf37&=&format=webp&quality=lossless&width=1024&height=307";
export const SESSION_FOOTER_IMAGE_URL =
  "https://media.discordapp.net/attachments/1535866584290304072/1538028078473937017/image.png?ex=6a812fc5&is=6a7fde45&hm=b3a07fcecf5134089cfb9727979d58af426ddaebc55d3f54fd64886a17d8690b&=&format=webp&quality=lossless";

export const SESSION_VOTE_THRESHOLD = 10;
export const SESSION_PANEL_UPDATE_INTERVAL_MS = 15_000;

// !media relay (user ask, 2026-08-14) — anyone holding this role, in any channel, posting "!media"
// with an attached image gets it reposted (with a camera emoji + their mention) to this channel.
export const MEDIA_RELAY_ROLE_ID = "1535866581853413376";
export const MEDIA_RELAY_CHANNEL_ID = "1535866584881438832";
export const MEDIA_RELAY_EMOJI = "<:camera:1538036373959741561>";

// UNCONFIRMED — no kick command has ever been confirmed live, same class of guess as
// RELOAD_COMMAND_TEMPLATE/PM_COMMAND_TEMPLATE below. Used by /sessiondown's shutdown sequence.
export const KICK_COMMAND_TEMPLATE = process.env.ERLC_KICK_COMMAND_TEMPLATE ?? ":kick {username}";

// UNCONFIRMED — role assignment on verification (Community Member + Verified, remove Unverified)
// was asked for but no real role IDs were given. Left unset on purpose (not guessed) so the
// verification embed's "Role assignment" rundown line honestly reports □ (not done) instead of
// silently assigning wrong roles to real members. Set these once the real IDs are known.
export const COMMUNITY_MEMBER_ROLE_ID = process.env.COMMUNITY_MEMBER_ROLE_ID;
export const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
export const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;

// Deduped across RCMP + BCHP + Ownership for the /callsign assign rank dropdown — actual validity
// per department is still checked against CALLSIGN_RANGES when the command runs (this is why
// picking "Ownership" as the rank under RCMP/BCHP correctly gets rejected — that combination
// doesn't exist in CALLSIGN_RANGES).
export const RANK_CHOICES = [
  { name: "Constable", value: "constable" },
  { name: "Corporal", value: "corporal" },
  { name: "Sergeant", value: "sergeant" },
  { name: "Staff Sergeant", value: "staff-sergeant" },
  { name: "Inspector", value: "inspector" },
  { name: "Superintendent", value: "superintendent" },
  { name: "Chief Superintendent", value: "chief-superintendent" },
  { name: "Commissioner", value: "commissioner" },
  { name: "Ownership", value: "ownership" },
];
