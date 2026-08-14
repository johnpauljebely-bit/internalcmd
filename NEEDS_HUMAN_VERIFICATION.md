# Needs human verification

Things that genuinely can't be self-tested or self-provisioned. Updated as they come up.

## Blocking / needs action

- **ER:LC hasn't allowlisted this bot's IP — every `:h` command has been silently failing.**
  Confirmed via a real API call: `403 {"code":4000,"message":"You are not authorized to perform
  this action on this server. If you are creating your own custom bot, visit
  https://api.erlc.gg/server-owners to allowlist your IP address."}`. This affects BOLO
  broadcasts, pursuit PA announcements, and (once enabled) compliance force-respawn/PM actions —
  all of them, silently, this whole time. **Visit https://api.erlc.gg/server-owners and allowlist
  this dev machine's current IP: `173.180.215.120`.** Will need doing again for whatever IP the
  eventual Oracle VM uses. `erlcClient.ts` now specifically detects and logs this 403 case
  clearly instead of a bare "failed: 403", so it should self-diagnose if it happens again.
- **Cloudflare quick tunnel URL changed again (2026-08-14) — update ER:LC's webhook dashboard.**
  The tunnel died (stuck in a connection-failure retry loop for a while — the old URL is dead) and
  was restarted with a fresh URL: `https://importantly-scientist-scan-prostores.trycloudflare.com`.
  This is the root cause behind a real bug report ("911/panic/traffic-stop don't broadcast in the
  VC on the live site") — the CAD's Vercel deployment had `BOT_INTERNAL_API_URL` pointing at
  `http://localhost:3000`, which it can never reach; now pointed at this tunnel URL instead (see
  COORDINATION.md). **Two things only you can do**: (1) update ER:LC's webhook settings to
  `https://importantly-scientist-scan-prostores.trycloudflare.com/webhook/erlc` — chat commands
  (`;verify`, `;mod`, etc.) may have silently stopped arriving when the old tunnel died, separate
  from the VC-broadcast symptom. (2) **Consider a named tunnel instead of quick tunnels going
  forward** — confirmed live that quick tunnels genuinely drop some requests even while "up"
  (`POST /internal/announce` got a real Cloudflare-edge 502 twice in a row while `GET /health`
  succeeded every time on the same tunnel — cloudflared's own log showed zero errors, so this isn't
  a bug, it's the documented behavior of account-less tunnels: "no uptime guarantee"). A named
  tunnel (permanent hostname, real reliability, survives bot restarts without needing a URL update
  anywhere) needs `cloudflared tunnel login` — interactive browser auth, can't be done unattended.
  `deploy/README.md` step 5 already has the full named-tunnel setup once you're ready to run that.
- **No VM exists yet — this is the actual remaining blocker to real hosting.** Still can't sign up
  for Oracle Cloud (or any host) on the user's behalf — needs a real card + personal info. The bot
  currently runs locally on the dev machine via `npx tsx src/index.ts` + a Cloudflare tunnel, not
  on any real server. `deploy/README.md` + the systemd unit are complete and now also cover
  Postgres provisioning (2026-08-13, was previously missing) — genuinely copy-paste-ready once a
  VM exists, but untested against a real VM since none has ever existed. **Next action is on the
  user**: provision any Linux host (Oracle Free Tier, or any other VPS) and follow
  `deploy/README.md` end to end.
- **This dev machine (M1, 8GB RAM) is under real memory pressure — one major contributor removed
  2026-08-14.** Confirmed via `sysctl vm.swapusage` back when STT was still live: **10.6GB of
  12GB swap in use** immediately after a fresh restart with only Node + the Vosk STT server + the
  Piper TTS server running — nothing else. The Vosk STT server (one of the two persistent
  heavy processes) is now gone entirely — the whole voice-understanding side (STT, the rules
  engine, `src/ai/ollamaFallback.ts` and its never-wired-in local-LLM fallback) was archived per
  the user's explicit call (see CHANGELOG.md), partly *because* of this exact memory pressure.
  Only Piper (TTS) remains as a persistent voice-related process now. Haven't re-measured swap
  freshly post-archive to confirm the improvement quantitatively — worth checking
  `sysctl vm.swapusage` again next time this comes up if latency complaints persist even for the
  (now much simpler) broadcast-only voice path.
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
