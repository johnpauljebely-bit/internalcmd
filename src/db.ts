import pg from "pg";

// Shared Postgres instance with the delta-city-cad website (see BOT_SIDE_INSTRUCTIONS.md in that
// repo). Replaces the earlier node:sqlite DatabaseSync — a real client-server DB is required so
// both processes can read/write the same live data, which a file-based embedded engine can't do
// safely across two independent processes. Every exported function here is now async as a direct
// consequence (network round-trip, not an in-process call) — every caller elsewhere in the bot had
// to be updated to await these. Local Postgres over a loopback socket is sub-millisecond per
// query, negligible next to the ER:LC API round-trips already in the voice dispatcher's hot path.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Creates every table this bot (and the CAD website, for the tables it shares) depends on, plus
// additive column migrations for columns introduced after a table already had rows. Postgres
// supports `ADD COLUMN IF NOT EXISTS` natively — no try/catch-on-duplicate-column dance needed
// like the old SQLite version required. Must be awaited once at startup before anything else runs
// (see index.ts) — unlike the old synchronous DatabaseSync constructor, this can't happen at
// module-load time.
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      discord_id TEXT PRIMARY KEY,
      roblox_username TEXT NOT NULL UNIQUE,
      roblox_user_id TEXT,
      verified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verify_codes (
      code TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      roblox_username TEXT NOT NULL,
      roblox_user_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS callsigns (
      department TEXT NOT NULL,
      number INTEGER NOT NULL,
      rank TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      assigned_by TEXT NOT NULL DEFAULT '',
      total_seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (department, number)
    );

    -- Extended per delta-city-cad's BOT_SIDE_INSTRUCTIONS.md #2 — the CAD's Active Call form
    -- needs richer fields than the bot itself writes. call_number auto-increments for the CAD's
    -- "CAD-#####" display format; the bot never sets it, Postgres generates it.
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      call_number SERIAL NOT NULL,
      title TEXT,
      description TEXT,
      team TEXT,
      department TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      type TEXT,
      origin TEXT,
      primary_unit_callsign TEXT,
      panels TEXT NOT NULL DEFAULT 'All',
      code TEXT,
      priority TEXT,
      postal TEXT,
      address TEXT,
      source TEXT NOT NULL,
      civilian_discord_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      cleared_at TEXT
    );

    CREATE TABLE IF NOT EXISTS call_units (
      call_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (call_id, discord_id)
    );

    -- CAD-owned, append-only — no bot code writes here, but it must live in the same database
    -- (BOT_SIDE_INSTRUCTIONS.md #2).
    CREATE TABLE IF NOT EXISTS call_notes (
      id SERIAL PRIMARY KEY,
      call_id TEXT NOT NULL,
      note_type TEXT NOT NULL DEFAULT 'Text',
      note_text TEXT NOT NULL,
      author_discord_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Officer-initiated (via "10-11 postal X ... with a [vehicle]"), distinct from EmergencyCalls-
    -- sourced "calls" above. Bot-only — not part of the CAD's shared schema.
    CREATE TABLE IF NOT EXISTS traffic_stops (
      id TEXT PRIMARY KEY,
      officer_discord_id TEXT NOT NULL,
      postal TEXT,
      vehicle_description TEXT,
      plate TEXT,
      created_at TEXT NOT NULL,
      cleared_at TEXT
    );

    CREATE TABLE IF NOT EXISTS traffic_stop_units (
      traffic_stop_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (traffic_stop_id, discord_id)
    );

    -- CAD's Active Units board (BOT_SIDE_INSTRUCTIONS.md #3) — upserted by the existing 60s duty
    -- poller in callsignDutyTracker.ts, not a new poller.
    CREATE TABLE IF NOT EXISTS live_units (
      callsign_key TEXT PRIMARY KEY,
      department TEXT NOT NULL,
      number INTEGER NOT NULL,
      discord_id TEXT,
      roblox_username TEXT,
      rank TEXT,
      on_duty BOOLEAN NOT NULL DEFAULT false,
      call_id TEXT,
      postal TEXT,
      location TEXT,
      agency TEXT,
      subdivision TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Broader live-state mirror (BOT_SIDE_INSTRUCTIONS.md #6/#7 in delta-city-cad) — every player
    -- currently online, not just ones with an assigned callsign like live_units. Covers the
    -- chicken-and-egg gap for Delta PD onboarding (no callsigns row exists yet to look up a live
    -- in-game callsign against) and gives the CAD a general-purpose live-state table for things
    -- like a future Map page instead of narrow one-off asks. location_x/z are separate numeric
    -- columns here (unlike live_units.location's combined string) specifically because distance
    -- math / map pins were the stated reason for wanting them split.
    CREATE TABLE IF NOT EXISTS live_players (
      roblox_username TEXT PRIMARY KEY,
      roblox_user_id TEXT,
      team TEXT,
      callsign TEXT,
      postal TEXT,
      location_x DOUBLE PRECISION,
      location_z DOUBLE PRECISION,
      wanted_stars INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  for (const stmt of [
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_number SERIAL",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS title TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS department TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS type TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS origin TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS primary_unit_callsign TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS panels TEXT NOT NULL DEFAULT 'All'",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS code TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS priority TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS address TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'erlc_native'",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS civilian_discord_id TEXT",
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS created_by TEXT",
  ]) {
    await pool.query(stmt);
  }

  console.log("[db] Postgres schema ready");
}

export interface LinkRow {
  discord_id: string;
  roblox_username: string;
  roblox_user_id: string | null;
  verified_at: string;
}

export interface CallsignRow {
  department: string;
  number: number;
  rank: string;
  discord_id: string;
  assigned_at: string;
  assigned_by: string;
  total_seconds: number;
}

export async function createVerifyCode(
  discordId: string,
  robloxUsername: string,
  robloxUserId: string,
  code: string,
): Promise<void> {
  await pool.query(
    "INSERT INTO verify_codes (code, discord_id, roblox_username, roblox_user_id, created_at) VALUES ($1, $2, $3, $4, $5)",
    [code, discordId, robloxUsername, robloxUserId, new Date().toISOString()],
  );
}

// Matches by Roblox user ID (what the webhook actually gives us for the sender), not username —
// stronger than a username-string comparison and immune to display-name changes.
export async function consumeVerifyCode(code: string, claimedByRobloxUserId: string) {
  const { rows } = await pool.query<{
    code: string;
    discord_id: string;
    roblox_username: string;
    roblox_user_id: string | null;
    created_at: string;
  }>("SELECT * FROM verify_codes WHERE code = $1", [code]);
  const row = rows[0];

  if (!row) return { ok: false as const, reason: "unknown-code" as const };

  if (!row.roblox_user_id || row.roblox_user_id !== claimedByRobloxUserId) {
    return { ok: false as const, reason: "user-id-mismatch" as const };
  }

  await pool.query("DELETE FROM verify_codes WHERE code = $1", [code]);
  await pool.query(
    `INSERT INTO links (discord_id, roblox_username, roblox_user_id, verified_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (discord_id) DO UPDATE SET roblox_username = EXCLUDED.roblox_username,
       roblox_user_id = EXCLUDED.roblox_user_id, verified_at = EXCLUDED.verified_at`,
    [row.discord_id, row.roblox_username, row.roblox_user_id, new Date().toISOString()],
  );

  return {
    ok: true as const,
    discordId: row.discord_id,
    robloxUsername: row.roblox_username,
    robloxUserId: row.roblox_user_id,
  };
}

export async function findLinkByRobloxUsername(username: string): Promise<LinkRow | undefined> {
  const { rows } = await pool.query<LinkRow>(
    "SELECT * FROM links WHERE LOWER(roblox_username) = LOWER($1)",
    [username],
  );
  return rows[0];
}

export async function findLinkByRobloxUserId(robloxUserId: string): Promise<LinkRow | undefined> {
  const { rows } = await pool.query<LinkRow>("SELECT * FROM links WHERE roblox_user_id = $1", [robloxUserId]);
  return rows[0];
}

export async function findLinkByDiscordId(discordId: string): Promise<LinkRow | undefined> {
  const { rows } = await pool.query<LinkRow>("SELECT * FROM links WHERE discord_id = $1", [discordId]);
  return rows[0];
}

export async function getTakenCallsignNumbers(department: string): Promise<number[]> {
  const { rows } = await pool.query<{ number: number }>(
    "SELECT number FROM callsigns WHERE department = $1",
    [department],
  );
  return rows.map((r) => r.number);
}

export async function assignCallsign(
  department: string,
  number: number,
  rank: string,
  discordId: string,
  assignedBy: string,
): Promise<void> {
  await pool.query(
    "INSERT INTO callsigns (department, number, rank, discord_id, assigned_at, assigned_by, total_seconds) VALUES ($1, $2, $3, $4, $5, $6, 0)",
    [department, number, rank, discordId, new Date().toISOString(), assignedBy],
  );
}

export async function getCallsignsByDiscordId(discordId: string): Promise<CallsignRow[]> {
  const { rows } = await pool.query<CallsignRow>("SELECT * FROM callsigns WHERE discord_id = $1", [discordId]);
  return rows;
}

export async function getAllCallsigns(): Promise<CallsignRow[]> {
  const { rows } = await pool.query<CallsignRow>("SELECT * FROM callsigns");
  return rows;
}

// Scoped to one department, not all of a user's callsigns — someone can hold more than one at
// once (e.g. an RCMP callsign plus an Ownership one), so removing/reassigning within a single
// department must never touch an unrelated department's row for the same person.
export async function removeCallsignForDepartment(discordId: string, department: string): Promise<number> {
  const result = await pool.query("DELETE FROM callsigns WHERE discord_id = $1 AND department = $2", [
    discordId,
    department,
  ]);
  return result.rowCount ?? 0;
}

export async function incrementCallsignDuty(department: string, number: number, seconds: number): Promise<void> {
  await pool.query(
    "UPDATE callsigns SET total_seconds = total_seconds + $1 WHERE department = $2 AND number = $3",
    [seconds, department, number],
  );
}

export interface CallRow {
  id: string;
  description: string | null;
  team: string | null;
  postal: string | null;
  created_at: string;
  cleared_at: string | null;
}

// source defaults to 'erlc_native' for calls the bot creates from ER:LC's EmergencyCalls feed —
// distinguishes them from CAD-originated ('caller') and voice-reported ('leo', e.g. a panic that
// never arrived as a confirmed ER:LC webhook event) calls, per BOT_SIDE_INSTRUCTIONS.md #2.
export async function recordNewCall(
  id: string,
  description: string,
  team: string | null,
  postal: string,
  source: string = "erlc_native",
  type: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO calls (id, description, team, postal, source, type, created_at, cleared_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, team = EXCLUDED.team,
       postal = EXCLUDED.postal, type = EXCLUDED.type, created_at = EXCLUDED.created_at, cleared_at = NULL`,
    [id, description, team, postal, source, type, new Date().toISOString()],
  );
}

export async function markCallCleared(id: string): Promise<void> {
  await pool.query("UPDATE calls SET cleared_at = $1, status = 'cleared' WHERE id = $2", [
    new Date().toISOString(),
    id,
  ]);
}

export async function getActiveCalls(): Promise<CallRow[]> {
  const { rows } = await pool.query<CallRow>(
    "SELECT id, description, team, postal, created_at, cleared_at FROM calls WHERE cleared_at IS NULL",
  );
  return rows;
}

export interface CallUnitRow {
  discord_id: string;
  assigned_at: string;
}

// Future CAD dashboard's data source for "who's responding to this call" — no dedup beyond one
// row per (call, unit): re-attaching just refreshes assigned_at rather than erroring.
export async function assignUnitToCall(callId: string, discordId: string): Promise<void> {
  await pool.query(
    `INSERT INTO call_units (call_id, discord_id, assigned_at) VALUES ($1, $2, $3)
     ON CONFLICT (call_id, discord_id) DO UPDATE SET assigned_at = EXCLUDED.assigned_at`,
    [callId, discordId, new Date().toISOString()],
  );
}

export async function getUnitsForCall(callId: string): Promise<CallUnitRow[]> {
  const { rows } = await pool.query<CallUnitRow>(
    "SELECT discord_id, assigned_at FROM call_units WHERE call_id = $1",
    [callId],
  );
  return rows;
}

export interface TrafficStopRow {
  id: string;
  officer_discord_id: string;
  postal: string | null;
  vehicle_description: string | null;
  plate: string | null;
  created_at: string;
  cleared_at: string | null;
}

export async function startTrafficStopRecord(
  id: string,
  officerDiscordId: string,
  postal: string,
  vehicleDescription: string,
): Promise<void> {
  await pool.query(
    "INSERT INTO traffic_stops (id, officer_discord_id, postal, vehicle_description, created_at, cleared_at) VALUES ($1, $2, $3, $4, $5, NULL)",
    [id, officerDiscordId, postal, vehicleDescription, new Date().toISOString()],
  );
}

// Most recent still-open stop for this officer — voice sessions are one-active-speaker-at-a-time
// so in practice there's only ever one, but ORDER BY guards against stale unclosed rows.
export async function getActiveTrafficStopForOfficer(officerDiscordId: string): Promise<TrafficStopRow | undefined> {
  const { rows } = await pool.query<TrafficStopRow>(
    "SELECT * FROM traffic_stops WHERE officer_discord_id = $1 AND cleared_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [officerDiscordId],
  );
  return rows[0];
}

export async function recordTrafficStopPlate(id: string, plate: string): Promise<void> {
  await pool.query("UPDATE traffic_stops SET plate = $1 WHERE id = $2", [plate, id]);
}

export async function assignUnitToTrafficStop(trafficStopId: string, discordId: string): Promise<void> {
  await pool.query(
    `INSERT INTO traffic_stop_units (traffic_stop_id, discord_id, assigned_at) VALUES ($1, $2, $3)
     ON CONFLICT (traffic_stop_id, discord_id) DO UPDATE SET assigned_at = EXCLUDED.assigned_at`,
    [trafficStopId, discordId, new Date().toISOString()],
  );
}

// CAD's Active Units board (BOT_SIDE_INSTRUCTIONS.md #3) — one row per assigned callsign, upserted
// every 60s by callsignDutyTracker.ts's existing poll loop. Not a new poller; this just persists
// what that loop already computes on each pass instead of discarding it.
export interface LiveUnitUpsert {
  callsignKey: string;
  department: string;
  number: number;
  discordId: string | null;
  robloxUsername: string | null;
  rank: string | null;
  onDuty: boolean;
  postal: string | null;
  location: string | null;
}

export async function upsertLiveUnit(u: LiveUnitUpsert): Promise<void> {
  await pool.query(
    `INSERT INTO live_units (callsign_key, department, number, discord_id, roblox_username, rank, on_duty, postal, location, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (callsign_key) DO UPDATE SET
       department = EXCLUDED.department, number = EXCLUDED.number, discord_id = EXCLUDED.discord_id,
       roblox_username = EXCLUDED.roblox_username, rank = EXCLUDED.rank, on_duty = EXCLUDED.on_duty,
       postal = EXCLUDED.postal, location = EXCLUDED.location, updated_at = now()`,
    [u.callsignKey, u.department, u.number, u.discordId, u.robloxUsername, u.rank, u.onDuty, u.postal, u.location],
  );
}

// Broader live-state mirror (BOT_SIDE_INSTRUCTIONS.md #6/#7) — one row per player currently online,
// regardless of whether they hold an assigned callsign. No "online" boolean: a row is only ever
// upserted when that player appears in a live getServerPlayers() poll, so "is this player online
// right now" is "is updated_at recent" (within one poll interval) — same convention already
// established for live_units' own staleness, just without a separate on_duty-style flag since
// every player, not just duty-toggled ones, is written here every pass.
export interface LivePlayerUpsert {
  robloxUsername: string;
  robloxUserId: string | null;
  team: string | null;
  callsign: string | null;
  postal: string | null;
  locationX: number | null;
  locationZ: number | null;
  wantedStars: number | null;
}

export async function upsertLivePlayer(p: LivePlayerUpsert): Promise<void> {
  await pool.query(
    `INSERT INTO live_players (roblox_username, roblox_user_id, team, callsign, postal, location_x, location_z, wanted_stars, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (roblox_username) DO UPDATE SET
       roblox_user_id = EXCLUDED.roblox_user_id, team = EXCLUDED.team, callsign = EXCLUDED.callsign,
       postal = EXCLUDED.postal, location_x = EXCLUDED.location_x, location_z = EXCLUDED.location_z,
       wanted_stars = EXCLUDED.wanted_stars, updated_at = now()`,
    [p.robloxUsername, p.robloxUserId, p.team, p.callsign, p.postal, p.locationX, p.locationZ, p.wantedStars],
  );
}

export interface LivePlayerRow {
  roblox_username: string;
  roblox_user_id: string | null;
  team: string | null;
  callsign: string | null;
  postal: string | null;
  location_x: number | null;
  location_z: number | null;
  wanted_stars: number | null;
  updated_at: Date; // pg parses timestamptz into a JS Date automatically, not a string
}

// Case-insensitive on roblox_username, matching the CAD's own lookup convention (see
// COORDINATION.md) so a case mismatch between how someone linked vs. how ER:LC reports their
// username doesn't cause a false "not found."
export async function getLivePlayerByUsername(username: string): Promise<LivePlayerRow | undefined> {
  const { rows } = await pool.query<LivePlayerRow>(
    "SELECT * FROM live_players WHERE LOWER(roblox_username) = LOWER($1)",
    [username],
  );
  return rows[0];
}

// Writes into the CAD's own live_units.status/call_id columns (added by the CAD side for its
// 5-state duty-status UI — available/unavailable/busy/enroute/on_scene, see
// delta-city-cad/src/lib/unitStatus.ts) so a voice status report shows up there in real time, not
// just as a spoken ack. Deliberately does NOT touch on_duty/postal/location/etc — those stay
// owned by callsignDutyTracker.ts's own upsert, this only ever writes status + call_id.
// `callId` semantics: omit entirely (undefined) to leave call_id untouched (e.g. "show me busy"
// shouldn't erase a call they're still working), pass `null` to explicitly clear it (e.g. going
// back "available" means done with whatever call they had), pass a string to attach one.
export async function updateLiveUnitStatus(
  callsignKey: string,
  status: string,
  callId?: string | null,
): Promise<void> {
  if (callId === undefined) {
    await pool.query("UPDATE live_units SET status = $1, updated_at = now() WHERE callsign_key = $2", [
      status,
      callsignKey,
    ]);
  } else {
    await pool.query(
      "UPDATE live_units SET status = $1, call_id = $2, updated_at = now() WHERE callsign_key = $3",
      [status, callId, callsignKey],
    );
  }
}

export default pool;
