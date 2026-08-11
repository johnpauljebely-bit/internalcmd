import { RELOAD_COMMAND_TEMPLATE, PM_COMMAND_TEMPLATE } from "./config.js";

const BASE_URL = "https://api.erlc.gg/v2";

function serverKey() {
  const key = process.env.ERLC_SERVER_KEY;
  if (!key) throw new Error("ERLC_SERVER_KEY is not set");
  return key;
}

async function erlcFetch(pathname: string, init: RequestInit, attempt = 1): Promise<Response> {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      ...init.headers,
      "server-key": serverKey(),
    },
  });

  if (res.status === 429 && attempt <= 3) {
    const retryAfterHeader = res.headers.get("X-RateLimit-Reset-After") ?? res.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000 * attempt;
    console.warn(`[erlc] 429 rate limited, retrying in ${retryAfterMs}ms (attempt ${attempt})`);
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return erlcFetch(pathname, init, attempt + 1);
  }

  return res;
}

export interface ErlcPlayer {
  Player: string; // "Username:UserId"
  Permission: string;
  Callsign?: string;
  Team?: string;
  Location?: { LocationX?: number; LocationZ?: number };
  PostalCode?: string;
  WantedStars?: number;
}

export async function getServerPlayers(): Promise<ErlcPlayer[] | null> {
  try {
    const res = await erlcFetch("/server?Players=true", { method: "GET" });
    if (!res.ok) {
      console.error(`[erlc] GET /server?Players=true failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { Players?: ErlcPlayer[] } | ErlcPlayer[];
    return Array.isArray(data) ? data : (data.Players ?? []);
  } catch (err) {
    console.error("[erlc] GET /server?Players=true errored", err);
    return null;
  }
}

// Confirmed via a real call: the wrapper keys are "Players"/"EmergencyCalls"/"Vehicles" at the
// top level. Per-item shape for a call is unconfirmed (no live call has been observed yet) —
// this follows the docs' field names (Team, Caller, Position, StartedAt, CallNumber, Description).
export interface ErlcCall {
  Team?: string;
  Caller?: string;
  Position?: unknown;
  StartedAt?: number;
  CallNumber?: string;
  Description?: string;
}

export async function getServerCalls(): Promise<ErlcCall[] | null> {
  try {
    const res = await erlcFetch("/server?EmergencyCalls=true", { method: "GET" });
    if (!res.ok) {
      console.error(`[erlc] GET /server?EmergencyCalls=true failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { EmergencyCalls?: ErlcCall[] };
    return data.EmergencyCalls ?? [];
  } catch (err) {
    console.error("[erlc] GET /server?EmergencyCalls=true errored", err);
    return null;
  }
}

// Confirmed live 2026-08-11: same query-flag pattern as Players/EmergencyCalls (NOT a separate
// path — an earlier guess at /server/commandlogs 404'd). Real response:
// { ..., "CommandLogs": [{ "Player": "username:userid", "Command": ":time 10", "Timestamp": 1786472049 }] }
export interface ErlcCommandLog {
  Player?: string;
  Timestamp?: number;
  Command?: string;
}

export async function getCommandLogs(): Promise<ErlcCommandLog[] | null> {
  try {
    const res = await erlcFetch("/server?CommandLogs=true", { method: "GET" });
    if (!res.ok) {
      console.error(`[erlc] GET /server?CommandLogs=true failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { CommandLogs?: ErlcCommandLog[] };
    return data.CommandLogs ?? [];
  } catch (err) {
    console.error("[erlc] GET /server?CommandLogs=true errored", err);
    return null;
  }
}

export async function sendServerCommand(command: string): Promise<boolean> {
  try {
    const res = await erlcFetch("/server/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!res.ok) {
      if (res.status === 403) {
        const body = await res.text().catch(() => "");
        console.error(
          `[erlc] POST /server/command "${command}" failed: 403 Forbidden. This server's IP is ` +
            `almost certainly not allowlisted — visit https://api.erlc.gg/server-owners and add ` +
            `this bot's outbound IP. Response: ${body}`,
        );
      } else {
        console.error(`[erlc] POST /server/command "${command}" failed: ${res.status}`);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[erlc] POST /server/command "${command}" errored`, err);
    return false;
  }
}

export async function announcePA(message: string): Promise<boolean> {
  return sendServerCommand(`:h ${message}`);
}

export async function forceRespawn(username: string): Promise<boolean> {
  const command = RELOAD_COMMAND_TEMPLATE.replace("{username}", username);
  return sendServerCommand(command);
}

export async function sendPrivateMessage(username: string, message: string): Promise<boolean> {
  const command = PM_COMMAND_TEMPLATE.replace("{username}", username).replace("{message}", message);
  return sendServerCommand(command);
}
