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
- **No VM exists yet — this is the actual remaining blocker to real hosting.** Still can't sign up
  for Oracle Cloud (or any host) on the user's behalf — needs a real card + personal info. The bot
  currently runs locally on the dev machine via `npx tsx src/index.ts` + a Cloudflare tunnel, not
  on any real server. `deploy/README.md` + the systemd unit are complete and now also cover
  Postgres provisioning (2026-08-13, was previously missing) — genuinely copy-paste-ready once a
  VM exists, but untested against a real VM since none has ever existed. **Next action is on the
  user**: provision any Linux host (Oracle Free Tier, or any other VPS) and follow
  `deploy/README.md` end to end.
- **This dev machine (M1, 8GB RAM) is under real memory pressure just running the existing stack.**
  Confirmed via `sysctl vm.swapusage`: **10.6GB of 12GB swap in use** immediately after a fresh
  restart with only Node + the Vosk STT server + the Piper TTS server running — nothing else. This
  is a very plausible standing contributor to "laggy as hell" latency complaints beyond anything
  fixable in application code: when a process's working set gets paged out to swap, the next real
  work it does (e.g. transcribing an utterance) pays disk I/O to page back in before it can even
  start. Likely made worse by whatever else is normally open on this machine day-to-day. The
  planned move to the Oracle VM (above) would give the bot dedicated resources instead of sharing
  an already-tight 8GB with everything else — that's probably the real fix, not a code change.
  Tested and ruled out running a local LLM (see the AI-fallback entry below) specifically because
  of this — there wasn't enough headroom left for it.
- **AI fallback for unrecognized voice commands — built but NOT wired in, needs a decision.**
  Requested: when the rules engine can't match an utterance, ask an LLM (with live game context —
  active calls, online units) for a smarter answer instead of just "10-9, please repeat." Wanted
  free, so tried a local model via Ollama (`llama3.2:1b`) — installed, pulled, tested live: **a
  5-token test request took over 5 minutes**, and a follow-up request timed out entirely at 30s,
  both because of the swap pressure above. Not viable on this machine as-is. Ollama has been
  stopped (`brew services stop ollama`) so it's not competing for resources in the meantime. The
  code is written and ready but deliberately not wired into production: `src/ai/ollamaFallback.ts`
  (the Ollama HTTP client + prompt/context shape) and an optional `generateAiFallback` hook on
  `RadioDependencies` in `radioSession.ts` (inert when unset — every existing test and the real
  production `radioDeps` in `voiceSession.ts` both currently omit it, so behavior is unchanged).
  Three ways forward, all requiring a decision only the user can make: (1) pay for a hosted API
  (Anthropic/OpenAI) instead — fast, reliable, but not free (rough estimate: a few dollars/month at
  fallback-only usage since it never touches the hot path for recognized commands); (2) revisit
  local once the bot moves to the Oracle VM (dedicated RAM, no contention with a dev laptop's other
  apps); (3) skip the AI fallback and keep improving rules-engine coverage instead, which is what
  actually fixed today's real complaints (10-code word-vs-digit matching, handshake friction).
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
  official mention of one in the webhook docs. Not built. If/when officer-down actually happens
  in-game, check `logs/events-*.log` for anything unusual and report back — that's the only way
  to find out what it looks like, if it exists at all. **Worked around 2026-08-11**, not solved:
  since dispatch can't auto-detect a panic, an officer can now self-report one by voice ("attach
  me to the panic at postal X") and dispatch creates the call record on the spot rather than
  failing to recognize it — see the CHANGELOG entry. Doesn't need this event to ever be confirmed
  to work; still worth finding out if/when it happens, since an automatic detection would be
  strictly better than relying on someone remembering to say it.
- **Status tracking + self-declared calls (2026-08-11) — built, never tested live.** Test all of:
  (1) say "1500 to dispatch show me 10-8" — expect "10-4, I understand, one five zero zero" spoken
  back, and `psql delta_city -c "select status, call_id from live_units where callsign_key='...'"`
  should show `status='available'`, `call_id` cleared to NULL. (2) With an active call already on
  file at a known postal, say "attach me to [description] at postal X" — expect attachment +
  `status='enroute'` + `call_id` set to that call. (3) With NO active call at some postal, say
  "attach me to the panic at postal X" — expect a brand new call to appear in `calls`
  (`source='leo'`), an RTO text post + in-game PA announcement about it, and the reporting unit
  attached + enroute. Then have a SECOND unit say "attach me to case #{that new case number}" and
  confirm they can also attach to the self-declared call same as any other. (4) Say "show me
  enroute to the call at postal X" (combined status+attach in one utterance) and confirm both the
  attach and the status/call_id update happen together, with a single natural spoken response
  rather than two separate exchanges.
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
  vehicle-status field), it needs figuring out live; nothing to build against yet.
- **Full traffic-stop voice workflow — never tested live, only unit-tested against fixtures.**
  With voice enabled and two linked/on-duty officers: say "{callsign} traffic stop when ready" →
  wait for go-ahead → "I'll be on a 10-11 postal 910 highway 55 with a red 4-door sedan. 28 when
  ready" → expect "28, go ahead" → say "28 reading ABC123" → expect the plate read back with NATO
  phonetics + "do you need additional units?" → say "yes" → expect the OTHER officer's real
  callsign announced as dispatched, with a postal. Then check `sqlite3 dispatch.db "select * from
  traffic_stops; select * from traffic_stop_units;"` to confirm it persisted. The "nearest unit"
  lookup uses the REPORTING officer's own live position (not a geocoded postal — there's no such
  mapping), so it needs both officers actually online and positioned somewhere apart to produce a
  meaningful "nearest" pick rather than a trivial one-candidate result.
- **Active-call announcement + "attach to call" (by description OR case number).** Never tested
  against a real call (still none observed). `call.Description` is assumed to be the crime type
  text — unconfirmed. Postal is a best-effort approximation (nearest unit's own postal, since
  `ErlcCall` has no postal field of its own). Test: when a real call fires, confirm the RTO/PA/voice
  announcement reads sensibly ("all units be advised, active {what shows here} at postal {what
  shows here}, case number {the call's real CallNumber}"), then have a linked officer say
  "{callsign} attach to {something matching the call description}" AND separately "{callsign}
  attach me to case #{the real case number}" and confirm dispatch responds correctly to both, with
  their real callsign + a postal, and that `calls`/`call_units` in `dispatch.db` actually got the
  rows (`sqlite3 dispatch.db "select * from calls; select * from call_units;"`).

## Needs a real Discord voice channel + live human (Phase 3)

**Status as of the fourth live test round:** speak direction confirmed working via self-test
(real VC join + playback, zero errors). Listen direction has been live-tested three times now,
each round finding and fixing a real issue: (1) small STT model mangled real speech → swapped for
a bigger/more accurate one, (2) handshake matcher too rigid for how people actually talk →
tolerant of filler words and compound number words now, (3) callsign addressing trusted parsed
digits over real identity, rules engine gave up too easily, and response latency was bad on two
fronts (STT AND TTS both reloading their models per-utterance) → all four fixed this round
(real DB callsign lookup, fuzzier intent matching, persistent TTS process, "10-9, please repeat"
phrasing). None of round 4's fixes have been tested live yet. Voice is `en_US-ryan-medium` (male).
Command is `/dispatch enable [voice_channel]` / `/dispatch disable`, Director/Executive/Manager
role required.

**How to test once you're back:**
1. Run `/dispatch enable` and pick a voice channel. Should reply "Voice dispatcher enabled in
   **[channel name]**." and the bot should visibly join it.
2. Say your callsign followed by "dispatch" or "central" — digit-by-digit is still most reliable
   ("one four zero nine dispatch") but compound words should work too ("fourteen oh nine
   dispatch"), and the connector word before the cue word no longer needs to be exactly "to."
   **As of 2026-08-10 you can also just say "dispatch" or "central" alone with no digits at all** —
   the real callsign always comes from who's actually on the voice connection, not from parsed
   digits, so this should work fine. Expect to hear back "**{your real assigned callsign}**, go
   ahead" — **should be YOUR actual callsign from `/callsign assign` or `/mylink`, not necessarily
   whatever digits you said** — plus a text summary in the channel's own chat. If you don't have a
   callsign assigned, expect "unassigned unit, go ahead" instead.
2b. **New**: say the handshake and your actual command together in one breath, e.g. "1500 to
   dispatch show me 10-8" — should be answered directly, no separate "go ahead" round-trip needed
   first. This was the top complaint from the last live round; confirm it actually feels natural
   now, not just technically working.
3. Say something recognized with some natural filler around it, e.g. "uh can you check plate
   ABC123 for me" or "my status is en route." Should work now, not just the exact bare phrasing.
   Also try a 10-code lookup phrased as "show me 10-8" (not just "what's 10-8") — this specific
   phrasing was confirmed broken in the last live round and should be fixed now.
4. Say something the rules engine won't recognize. Expect **"10-9, please repeat, {your
   callsign}"** (changed from "say again").
4b. **New**: try "attach me to case #{a real case number from an active call}" as an alternative to
   "attach to {crime description}" — both should work.
5. **Response speed** — should feel meaningfully faster than round 3 (both STT and TTS now stay
   loaded in persistent processes instead of reloading per response). Still not instant; report
   back on whether it's fast enough now or still needs work.
6. Try `/bolo` (and a pursuit via `;ps`, if you can safely trigger one) while the voice dispatcher
   is enabled — the announcement should now be SPOKEN in the VC, not just posted as text/PA.
7. With a second person, test the hold-queue behavior as before.
8. Run `/dispatch disable` to end the session.

**Known rough edges to watch for, not yet tunable from real data:**
- `LOW_CONFIDENCE_THRESHOLD` (0.6) — real confidence scores are wired through, but the threshold
  itself is untested against real speech. May need tuning.
- Utterance segmentation uses `EndBehaviorType.AfterSilence` with a 1000ms gap — untested whether
  that's too short (cuts off mid-sentence) or too long (feels laggy).
- Discord audio channel count assumed stereo (`channels: 2`) per Discord's standard Opus config —
  unverified this matches what `@discordjs/voice`'s receiver actually delivers in practice.
- 10-code list (`TEN_CODES` in `radioIntents.ts`) is a generic BC/RCMP guess, not confirmed
  against what this community actually uses.
