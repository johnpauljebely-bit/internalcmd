# Needs human verification

Things that genuinely can't be self-tested or self-provisioned. Updated as they come up.

## Blocking / needs action

- **Bot moved off the dev machine entirely (2026-08-14) — now hosted on Orihost (Pterodactyl,
  free tier).** Real infrastructure change: no longer `npx tsx` + a Cloudflare tunnel on the dev
  Mac — that tunnel is stopped, that whole approach is dead. Live at `176.100.37.91:30172`,
  confirmed externally reachable via a direct `/health` check. **The Oracle VM plan in
  `deploy/README.md` is now a secondary/future option, not the active path** — Orihost is free,
  no card required, and already working. Real problems hit and fixed along the way, useful context
  if this ever needs debugging again:
  - The container needs the app bound to its *specific* allocated port (`30172` here), not an
    arbitrary internal one — Pterodactyl doesn't do port remapping. `index.ts` now falls back to
    `SERVER_PORT` (Pterodactyl's standard env var) if `PORT` isn't set, but `PORT=30172` is also
    set explicitly in the remote `.env` since it wasn't confirmed whether Orihost actually injects
    `SERVER_PORT` — the explicit value is the one actually in effect.
  - Their file manager's "Unarchive" wraps zip contents in a folder named after the archive
    instead of extracting flat — cost a full crash-loop cycle (`Cannot find module
    '/home/container/dist/index.js'`) before catching it. Files had to be moved up a level.
  - Their Node egg auto-runs `npm install` on every boot if `package.json` exists at the root —
    intentional, uploading `node_modules` yourself gets silently skipped.
  - **No shell/console access on this host** — deployed via SFTP (`de-vip-01.orihost.com:2022`)
    instead. Any future code change needs re-uploading manually (`dist/index.js` at minimum,
    `voice/`/`package.json` if those change) — there's no auto-update, since `GIT_ADDRESS` etc.
    aren't set. Could switch to git-based auto-deploy (this repo already has a real GitHub remote)
    by setting `GIT_ADDRESS`/`BRANCH`/`USERNAME`/`ACCESS_TOKEN`/`AUTO_UPDATE=1` in Orihost's
    Startup variables — not done yet, current process is manual SFTP re-sync.
- **ER:LC's IP allowlist needs updating for the NEW outbound IP.** The old allowlisted IP
  (`173.180.215.120`) was the dev machine's — now that outbound ER:LC API calls come from Orihost
  instead, that allowlist entry is stale. Pterodactyl containers typically share their node's
  public IP for outbound traffic, so `176.100.37.91` (the same IP used for the port allocation) is
  the reasonable guess, but **not confirmed** — visit https://api.erlc.gg/server-owners and check/
  update. Until this is done, every `:h`/PA/force-respawn call will keep failing with the same 403
  this was already failing with before, just from a different IP now.
- **No HTTPS/domain — plain `http://176.100.37.91:30172`.** Orihost's free tier doesn't provide a
  domain. Works for the CAD's server-to-server fetch calls (HTTP is fine there), but ER:LC's
  webhook dashboard might reject a non-HTTPS URL outright — untested as of this writing. If it
  does, the fix is running a Cloudflare Tunnel pointed at this IP:port instead of `localhost` (same
  mechanism as before, just needs to run somewhere with real always-on access, not the dev laptop
  this time, or the whole point of moving off it is undermined).
- **Voice/Piper TTS is NOT set up on Orihost — confirmed non-fatal, but voice announcements don't
  work there yet.** `voice/setup.sh` needs to actually execute on the real container (downloads
  the Piper model, builds a matching Python venv) — with no console access, there's no way to
  trigger this automatically the way `deploy/README.md`'s VM path could. Confirmed live this
  doesn't crash anything (`[process] uncaught exception (kept running) ... spawn
  /home/container/voice/.venv/bin/python3 ENOENT` — caught by the existing safety net), just means
  `announceToActiveDispatcher`'s spoken half silently no-ops on this host. Needs either (a) Orihost
  support confirming some way to run one-off setup commands, or (b) switching to a host with real
  shell access for voice to work.
- **This dev machine (M1, 8GB RAM) is under real memory pressure — one major contributor removed
  2026-08-14, disk footprint also trimmed the same day.** Confirmed via `sysctl vm.swapusage` back
  when STT was still live: **10.6GB of 12GB swap in use** immediately after a fresh restart with
  only Node + the Vosk STT server + the Piper TTS server running — nothing else. The Vosk STT
  server (one of the two persistent heavy processes) is now gone entirely — the whole
  voice-understanding side (STT, the rules engine, `src/ai/ollamaFallback.ts` and its
  never-wired-in local-LLM fallback) was archived per the user's explicit call (see CHANGELOG.md),
  partly *because* of this exact memory pressure. Only Piper (TTS) remains as a persistent
  voice-related process now. Same day, also cleaned up real leftover disk usage: removed the Vosk
  model (~124MB) and 7 orphaned Python packages from `voice/.venv` that nothing actually imported
  anymore (`vosk`, `websockets`, `requests`, `cffi` + its transitive chain — verified each via `pip
  show ... Required-by` before removing, then re-tested real TTS synthesis after each round), plus
  a genuinely stale `dispatch.db` (pre-Postgres SQLite leftover from 2026-08-10, untouched since).
  Haven't re-measured swap freshly post-archive to confirm the memory improvement quantitatively —
  worth checking `sysctl vm.swapusage` again next time this comes up if latency complaints persist
  even for the (now much simpler) broadcast-only voice path.
- **`logs/events-*.log` grows unbounded, no rotation.** Modest today (~12KB/day at current low
  webhook volume), but genuinely unbounded — `eventLogger.ts` creates a new file per calendar day
  and never deletes old ones. Not urgent at this rate, but worth watching once real player traffic
  is flowing on a real host with a smaller disk budget; not building rotation logic unprompted
  since the current growth rate doesn't warrant it yet.
- **Bot's Discord role needs to move up the hierarchy.** Sits at position 1, below basically
  every staff role including the ones `/callsign manage` is gated on. Discord blocks nickname
  changes (and possibly other member-targeted actions) against anyone whose highest role outranks
  the bot's, regardless of Administrator. Confirmed via a real failed nickname reset. Drag
  "Delta Operations" role higher in Server Settings → Roles (above Community Directive at
  minimum) — I can't self-promote the bot's own role via the API.
- **No scratch/throwaway ER:LC server exists.** The brief calls for testing pursuit/panic/voice
  logic on a second private server, not the live "Delta Roleplay" production one. Confirmed via
  API that only one server exists (OwnerId 7822749012, join key `playdelta`). This is why
  compliance enforcement and PA-announcement testing have been kept dry-run/unexercised rather
  than fired for real.
- **This bot now depends on a fourth persistent local service: Postgres.** Added 2026-08-10 for
  the `delta-city-cad` integration (shared database, see CHANGELOG). Running via
  `brew services start postgresql@16` on this dev machine — need to confirm it's set to launch on
  boot / survive a machine restart the same way the rest of this stack needs to. Also adds to the
  memory-pressure item above: one more resident service on an already-tight 8GB machine, though
  Postgres itself is lightweight (default 128MB `shared_buffers`) compared to Vosk/Piper/a would-be
  local LLM.
- **`/callsign self-assign` (Delta PD) — rebuilt 2026-08-11 to derive the number from live ER:LC
  instead of taking one as an argument, never tested live end-to-end.** Test: get in-game with a
  valid Delta PD callsign (400-499) actually set, wait up to 30s for the compliance-monitor poll to
  populate `live_players`, then run `/callsign self-assign` (no arguments now) — confirm it reads
  the right number, confirm the Discord nickname updates to `{number} | {username}`, confirm
  `psql delta_city -c "select * from callsigns where department='delta-pd'"` shows the row. Also
  test the rejection paths: running it while offline/not-yet-polled (expect "get in-game first"),
  and running it with an invalid/unset in-game callsign (expect the "isn't a valid Delta PD number"
  message). And — once the CAD website is pointed at this same Postgres instance — confirm its own
  UI picks up the same row without any bot-side push needed (it's a shared table, not a sync
  mechanism).
- **Ownership callsigns (100-199) — built, never tested live.** Test: run `/callsign assign
  user:{someone WITHOUT the Community Directive role} department:Ownership rank:Ownership` —
  should be rejected with the "needs the Community Directive role" message. Then run it against
  someone who DOES hold that role — should succeed, assign the lowest free 100-199 number, and set
  their nickname. Confirm via `/callsign manage` that a person who already holds an RCMP/BCHP/Delta
  PD callsign can ALSO be given Ownership through the panel without their existing callsign getting
  wiped (this was a real bug found and fixed while building this — worth specifically confirming
  the fix actually works live, not just that it typechecks). Also worth double-checking the
  "directive role = eligibility gate on the target" interpretation is what was actually wanted —
  see the CHANGELOG entry for the reasoning, easy to change if not. **Also test the follow-up fix**:
  for someone holding two callsigns (e.g. RCMP + Ownership), use `/callsign manage`'s Remove button
  with only ONE department selected in the dropdown — confirm only that department's row gets
  deleted and the other survives, and that their nickname is untouched (still reflects the
  remaining callsign) rather than getting blanked.

- **Roleplay-quality hint wording (`src/roleplayHints.ts`)** — the user asked for hints covering
  "GTA driving, liveries, and more" but only specified those two categories. The current 8-hint
  list covers those two plus several inferred categories (powergaming, metagaming, radio
  discipline, parking). **Review the list and edit/expand it** — this is this codebase's own
  guess at "and more," not something dictated verbatim.
- **Join-code reminder + roleplay hints — never tested live.** Both new pollers
  (`joinReminder.ts`, `roleplayHints.ts`) are running (confirmed via startup logs), but PM
  delivery/PA broadcast depend on the same `:h`/PM ER:LC command path as everything else, which
  itself depends on the IP-allowlisting fix above. Confirm both actually land in-game once online.
- **RCMP/BCHP compliance retiming + exact-callsign match — never tested live.** The new grace
  period (2min soft PM → 6min → 1min hard-repeat) and exact-assigned-callsign check are unit-
  tested but `COMPLIANCE_ENFORCEMENT_ENABLED` is still off (dry-run only) — same blockers as the
  original Delta PD compliance monitor (TEAM_TO_DEPARTMENT Team-name mapping unconfirmed, reload
  command syntax unconfirmed). Also worth specifically confirming: an RCMP/BCHP officer holding a
  valid in-range callsign that ISN'T their CAD-assigned one now gets correctly flagged
  non-compliant (this is the actual behavior change #4 was about) — watch the dry-run logs for a
  real case of this once players are online.
- **Sheriff-team exemption role (`SHERIFF_COMPLIANCE_EXEMPT_ROLE_ID`,
  `1535866581853413383`)** — never confirmed this is the correct/current role ID for what the
  user meant by "exempt from CAD and the pms and loads." Confirm a real holder of this role is
  correctly skipped in the dry-run logs.
- **Mod-call flow (`;mod` + auto-detection) — never tested live end-to-end.** User confirmed the
  real waiting-room channel ID (`STAFF_WAITING_ROOM_VC_ID`, now hardcoded in `config.ts`) and the
  detection mechanism: no manual confirm command at all — `modCallDetector.ts` polls
  `GET /server?CommandLogs=true` every 10s and watches for a staff member's own `:tp` command
  targeting the waiting player's username, then drags both into a free `STAFF_SCENE_VC_IDS`
  channel. The endpoint/response shape is now confirmed live (`{Player, Command, Timestamp}`,
  same query-flag pattern as Players/EmergencyCalls — an earlier guess at a separate
  `/server/commandlogs` path 404'd and was fixed). **What's still unconfirmed**: the exact `:tp`
  command syntax/argument order (only a `:time 10` sample has been observed, no real teleport
  yet) — `commandTargetsPlayer()` in `modCallDetector.ts` parses defensively (any command
  containing the standalone word "tp", checking every other token against the waiting username)
  rather than assuming a fixed position, but this needs a real staff `:tp` to confirm it actually
  matches. Also confirm the full loop end to end: `;mod` drags the caller + PMs them + logs to
  server-management, then a real staff `:tp` to that player resolves it within ~10s.
- **CAD-login reminder (`cadReminder.ts`) — never tested live end-to-end.** Depends on the CAD's
  new `cad_activity` heartbeat (confirmed real rows are landing there as of 2026-08-14), so this is
  now enabled and running (every 2min). Confirm live: an on-duty, linked officer with the CAD tab
  closed gets PM'd "Get onto the CAD dashboard now — you're expected to be logged in while on
  duty."; opening the CAD (and staying on it) should stop the PMs within one poll cycle once their
  heartbeat lands. Also worth confirming the 3-minute staleness window (`CAD_ACTIVITY_STALE_MS`)
  isn't too tight against the CAD's actual 90s heartbeat interval — should be comfortable margin,
  but untested under real network conditions.
- **`POST /internal/notify-unit` — never tested live end-to-end.** Endpoint is registered and the
  CAD says its `notifyUnit()` calls are already wired into every auto-dispatch path (Traffic Stop
  backup, 911/311 auto-dispatch), previously no-oping since the route didn't exist. Confirm a real
  auto-dispatch actually results in an in-game PM now.

## Needs live gameplay to confirm (can't synthesize)

- **Panic event — does it even exist?** ER:LC's docs only document `CustomCommand` and
  (implicitly) emergency-call events. No panic event has ever been observed, and there's no
  official mention of one in the webhook docs. Not built, and no longer this repo's problem to
  solve: the original voice-based workaround (an officer self-reporting "attach me to the panic
  at postal X," which self-declared a call on the spot) was archived 2026-08-14 along with the
  rest of voice-understanding. The CAD's dashboard Panic button now does the same self-declare
  (`type='panic'`, confirmed via COORDINATION.md), so this is fully covered on the website side —
  still worth finding out what the real event looks like if it ever fires, but nothing depends on
  it anymore.
- **`TEAM_TO_DEPARTMENT` mapping (src/config.ts).** Guessed strings ("Delta Police Department",
  "RCMP", "BCHP") for ER:LC's live `Team` field — server has been empty every time it's been
  polled, so these have never been checked against a real online player. The compliance monitor
  silently no-ops for any player whose Team doesn't match one of these guesses. **Also now gates
  the new Delta-PD nickname-sync feature** (2026-08-10) — once this mapping is confirmed, test that
  a Delta PD officer picking a valid self-chosen callsign (400-499) in-game gets their Discord
  nickname automatically synced to `[callsign] | [username]` within one compliance poll (30s).
- **Force-respawn command syntax (`ERLC_RELOAD_COMMAND_TEMPLATE`, default `:load {username}`).**
  The brief itself flags this as needing live confirmation. Wrong syntax means the compliance
  monitor's force-respawn action (currently dry-run only) would silently do nothing or something
  unintended once enabled.
- **PM command syntax (`ERLC_PM_COMMAND_TEMPLATE`, default `:pm {username} {message}`).** This
  codebase's own guess — the brief doesn't specify one at all. Same risk as above.
- **`;ts`/`;scene` proximity radius (`ERLC_PROXIMITY_STUDS`, default 60).** Untested guess at
  what "nearby" should mean in ER:LC's coordinate units.
- **Emergency call `Position` field shape (`callDispatch.ts`).** No live call has happened, so
  the field's actual shape (object vs string, key names) is unconfirmed. Parsed defensively with
  multiple fallback shapes, but the nearest-unit line may come out wrong or missing on a real call
  until verified.
- **Roblox chat filter behavior on every announced message template** (pursuit start/update/end,
  BOLO, callsign nag PMs). All go through Roblox's chat filter via virtual server management —
  the brief explicitly warns this can silently alter or block phrasing. None of these templates
  have been seen filtered or unfiltered in-game yet.
- **Traffic-stop-fleeing auto-detection.** Explicitly unbuilt — no known ER:LC event/field for
  "vehicle fled a stop." If you find one (a webhook event, a sudden speed/position delta, a
  vehicle-status field), it needs figuring out live; nothing to build against yet. Note: the
  traffic-stop *voice* workflow this used to sit alongside was archived 2026-08-14 — the CAD's
  dashboard now owns traffic-stop tracking, including real nearest-unit backup dispatch.
- **Active-call announcement (RTO/PA/voice broadcast) — never tested against a real call.**
  `call.Description` is assumed to be the crime type text — unconfirmed. Postal is a best-effort
  approximation (nearest unit's own postal, since `ErlcCall` has no postal field of its own). Test:
  when a real call fires, confirm the RTO/PA/voice announcement reads sensibly ("all units be
  advised, active {what shows here} at postal {what shows here}, case number {the call's real
  CallNumber}"). (Attaching to a call by voice was archived 2026-08-14 along with the rest of
  voice-understanding — attaching now happens through the CAD's Calls board.)

## Needs a real Discord voice channel + live human (Phase 3)

**2026-08-14: rebuilt as broadcast-only.** The listen/understand side (STT, handshake protocol,
rules-engine intent matching — everything the old test plan here covered) was archived per the
user's explicit call; it's not part of this bot anymore (see CHANGELOG.md and
`~/Desktop/delta-city-dispatch-voice-understanding-archive/README.md`). What's left: dispatch can
join a voice channel and speak pre-scripted announcements into it (calls, panics, BOLOs, pursuits,
CAD-triggered messages via `/internal/announce`) — confirmed working via direct self-test (real VC
join + playback, zero errors) and via today's live debugging session (real announcements heard,
including the double-broadcast bug that got fixed). Voice is `en_US-ryan-medium` (male). Command is
`/dispatch enable [voice_channel]` / `/dispatch disable`, Director/Executive/Manager role required.

**Still worth confirming live**: run `/dispatch enable`, then trigger a 911 call/panic/BOLO/pursuit
and confirm it's actually spoken in the channel (not just PA'd) — and confirm the new text-chat
embed (2026-08-14) shows up in that channel's own text-in-voice chat alongside it, prefixed
"Dispatch: ...".
