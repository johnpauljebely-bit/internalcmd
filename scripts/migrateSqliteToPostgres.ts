// One-time migration: reads every row out of the old dispatch.db SQLite file and inserts it into
// the new shared Postgres database. Run manually once before cutover
// (`npx tsx scripts/migrateSqliteToPostgres.ts`) — not invoked automatically by the app. Safe to
// re-run: every insert is ON CONFLICT DO NOTHING, so re-running after a partial failure just
// skips rows that already made it across.
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import pg from "pg";
import { initDb } from "../src/db.js";

const sqlite = new DatabaseSync(path.join(process.cwd(), "dispatch.db"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function copyTable(table: string, columns: string[]) {
  const rows = sqlite.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as Record<string, unknown>[];
  if (rows.length === 0) {
    console.log(`[migrate] ${table}: 0 rows, nothing to do`);
    return;
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  let copied = 0;
  for (const row of rows) {
    const values = columns.map((c) => row[c]);
    const result = await pool.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
    if ((result.rowCount ?? 0) > 0) copied++;
  }
  console.log(`[migrate] ${table}: ${copied}/${rows.length} rows copied (rest already present)`);
}

async function main() {
  await initDb();
  await copyTable("links", ["discord_id", "roblox_username", "roblox_user_id", "verified_at"]);
  await copyTable("verify_codes", ["code", "discord_id", "roblox_username", "roblox_user_id", "created_at"]);
  await copyTable("callsigns", [
    "department",
    "number",
    "rank",
    "discord_id",
    "assigned_at",
    "assigned_by",
    "total_seconds",
  ]);
  // 'source' isn't in the old SQLite shape (added in the Postgres schema per
  // BOT_SIDE_INSTRUCTIONS.md #2) — backfill every pre-existing row as 'erlc_native', matching what
  // recordNewCall itself now always sets for bot-originated calls.
  const oldCalls = sqlite.prepare("SELECT id, description, team, postal, created_at, cleared_at FROM calls").all() as {
    id: string;
    description: string | null;
    team: string | null;
    postal: string | null;
    created_at: string;
    cleared_at: string | null;
  }[];
  let callsCopied = 0;
  for (const c of oldCalls) {
    const result = await pool.query(
      `INSERT INTO calls (id, description, team, postal, source, created_at, cleared_at)
       VALUES ($1, $2, $3, $4, 'erlc_native', $5, $6) ON CONFLICT DO NOTHING`,
      [c.id, c.description, c.team, c.postal, c.created_at, c.cleared_at],
    );
    if ((result.rowCount ?? 0) > 0) callsCopied++;
  }
  console.log(`[migrate] calls: ${callsCopied}/${oldCalls.length} rows copied (rest already present)`);

  await copyTable("call_units", ["call_id", "discord_id", "assigned_at"]);
  await copyTable("traffic_stops", [
    "id",
    "officer_discord_id",
    "postal",
    "vehicle_description",
    "plate",
    "created_at",
    "cleared_at",
  ]);
  await copyTable("traffic_stop_units", ["traffic_stop_id", "discord_id", "assigned_at"]);

  await pool.end();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] fatal", err);
  process.exit(1);
});
