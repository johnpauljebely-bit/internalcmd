# Changelog

Running log of what got built, decisions made on ambiguous points, and what broke + how it got fixed. Newest first.

## 2026-08-14 (cleanup for a smaller host) — Trimmed disk footprint, switched deploy to a compiled build

User wants to actually deploy on a smaller/cheaper host once one exists, so this pass was about
real footprint, not just tidiness — verified everything with real commands, not assumptions.

**Disk cleanup**: deleted a genuinely stale `dispatch.db` (pre-Postgres SQLite leftover, untouched
since 2026-08-10) and `.DS_Store`. In `voice/.venv`, removed 8 orphaned Python packages nothing
actually imports anymore — `vosk` and `websockets` (leftover from the STT archive earlier today),
then `requests`/`cffi`/`certifi`/`charset-normalizer`/`idna`/`urllib3`/`pycparser` (an old
`requests`+`cffi` chain, unclear origin, but confirmed via `pip show ... Required-by` that nothing
current depends on any of them). Verified real TTS synthesis after each removal round, not just
trusted pip's metadata — `tts_speak.py` and a full bot restart (persistent `tts_server.py` path)
both still work. `voice/requirements.txt` trimmed to match (17 lines → 7). Also moved the Vosk
model out earlier today; net effect of both cleanups together: `voice/.venv` went from ~204MB
(lib alone was 192MB) to ~172MB, `voice/models` from 264MB to 60MB.

**Deploy now uses the compiled build, not `npx tsx`.** Confirmed live: `npm run build` (tsc) then
`node dist/index.js` runs standalone — full functional restart, `/internal/announce` and
`/internal/notify-unit` both registered, TTS server ready, zero errors. Then tested
`npm prune --omit=dev` in an isolated scratch copy (separate port, same real Discord/DB
credentials briefly — killed immediately after confirming, no lasting duplicate-connection risk):
cut `node_modules` from 70MB to 35MB, and the pruned build still ran and passed a health check
clean. `deploy/README.md` step 4 and `deploy/delta-city-dispatch.service`'s `ExecStart` updated
to match — meaningful savings for a small/free-tier host: no TypeScript/tsx/`@types/*` installed
at runtime at all, no on-the-fly transpilation overhead.

**Flagged, not built**: `logs/events-*.log` has no rotation and grows forever (modest today,
~12KB/day) — noted in NEEDS_HUMAN_VERIFICATION.md as worth watching on a real host, not urgent
enough at current volume to build unprompted.

Local dev instance (`npx tsx src/index.ts`, port 3000) restarted and confirmed healthy after all
of this — nothing above touched the actual running dev process except the venv package removals,
which were verified safe both via a standalone script test and a full bot restart.

## 2026-08-14 (major cut) — Archived voice understanding (STT + rules engine), bot is broadcast-only now

User's call, verbatim: the officer-speaks-to-dispatch side was "slow and knows nothing, like a
toddler driving a car." Both complaints had real, honest root causes rather than being wrong: slow
was mostly memory pressure on the dev machine (Vosk STT + Piper TTS + Node together, confirmed
10.6GB/12GB swap earlier this project), and "knows nothing" was accurate — it was always a
hand-coded rules engine (`radioIntents.ts`), never real understanding, and the one attempt at an
AI fallback (`ai/ollamaFallback.ts`, local Ollama) was ruled out on this same machine (a 5-token
test request took 5+ minutes).

**Did not just delete it.** Per the user's explicit instruction, checked parity with the CAD
website first (full back-and-forth in COORDINATION.md) before touching anything — didn't want to
cut a capability that had no replacement. Verdict: 4/5 covered cleanly (status updates, attach-to-
call via the Panic button + Calls board, plate lookups, 10-code trivia); the one real gap
(stateful traffic-stop workflow with real nearest-unit backup dispatch) got built fresh on the
CAD's side rather than staying an accepted loss — real coordinates, a calibrated map transform,
actual proximity math, not a guess.

**What moved to `~/Desktop/delta-city-dispatch-voice-understanding-archive/`** (not deleted —
has its own README explaining what's there and how to revive it): `radioSession.ts` +
`radioIntents.ts` and their tests, `voice/sttServer.ts`, the Python STT scripts
(`stt_server.py`/`stt_transcribe.py`), the Vosk model itself (~124MB, frees real disk space),
`ai/ollamaFallback.ts`, and the original `setup.sh`/`requirements.txt` (before this cut).

**What changed in the live bot**:
- `voiceSession.ts` rewritten from ~250 lines to ~55 — join/connect/speak only, no
  `receiver.speaking` listener, no opus/ffmpeg decode pipeline, no `radioDeps` wiring.
  `VoiceDispatcherHandle` no longer has a `.session` field.
- `pursuit.ts`'s `isPursuitActive()` removed — its only caller (the listen pipeline, which used it
  to go quiet during a pursuit) no longer exists.
- `index.ts` no longer warms up an STT server; `commands/dispatch.ts`'s copy updated ("start
  listening" → "so dispatch can speak announcements into it").
- `prism-media` dropped from `package.json`'s direct dependencies (still pulled in transitively by
  `@discordjs/voice` itself, just no longer imported by this codebase's own code). `opusscript`
  stays — still needed for outbound audio encoding.
- `voice/setup.sh` and `voice/requirements.txt` no longer set up Vosk — Piper/TTS only now.

**What stays exactly as-is**: `activeDispatcherRegistry.ts`, `ttsServer.ts`, and every
`announceToActiveDispatcher()` call site from earlier today (calls, panics, BOLOs, pursuits, CAD
messages) — dispatch can still speak, it just never listens or responds again.

Bot starts noticeably faster now (no more ~20s Vosk model load on startup). tsc clean, test suite
now 57 tests (down from 123 — the removed 66 were `radioSession.test.ts`/`radioIntents.test.ts`,
which moved with their source). Restarted, confirmed healthy, `/dispatch` still registers and
works for broadcast.

## 2026-08-13 (mod call, rewritten) — Real waiting-room channel + auto-detection via command log, `/mod arrived` removed

User provided the two pieces of missing info from the earlier mod-call build: the real
`STAFF_WAITING_ROOM_VC_ID` (`1535866586924326962`, now hardcoded in `config.ts` like every other
confirmed channel ID), and — more significantly — a real detection mechanism they'd seen work
elsewhere: watch the ER:LC server logs for a staff member's own teleport-to-player command, not a
manual confirm command. Explicit instruction: **"no mod arrived command its auto using what i just
explained."**

Rebuilt accordingly:
- **Removed** `/mod arrived` entirely (`commands/mod.ts` deleted, deregistered from
  `discordBot.ts`, `MOD_CONFIRM_ROLE_IDS` removed from `config.ts` — no longer needed now that
  there's no command to gate).
- **Added** `src/modCallDetector.ts` — polls `getCommandLogs()` every 10s, watching for a `:tp`
  command whose arguments include a currently-waiting player's username. On match: drags both the
  caller and the teleporting staff member (resolved via their Discord link) into a free
  `STAFF_SCENE_VC_IDS` channel, PMs the caller, logs to server-management. Uses the same
  "baseline on first poll, only react to entries seen after that" pattern `callDispatch.ts`
  already established for calls — otherwise every historical command since server start would
  fire on the very first poll.
- **`erlcClient.ts`'s `getCommandLogs()` — built against a wrong guess, then fixed against the
  real API.** First guess was a separate `GET /server/commandlogs` path (matching how ER:LC's
  *other* log types are commonly documented) — 404'd live. Tested the same query-flag pattern
  already confirmed working for `Players`/`EmergencyCalls` (`GET /server?CommandLogs=true`) — 200,
  and the response shape (`{Player, Command, Timestamp}`) matched the field-name guess exactly,
  just nested under the wrong request shape. Fixed and confirmed against the real live API before
  restarting.

tsc clean, 119/119 tests passing, bot restarted, confirmed via logs: no more 404s, detector poller
running clean. `:tp` command syntax itself still unconfirmed (only a `:time 10` sample observed so
far, no real teleport yet) — flagged in NEEDS_HUMAN_VERIFICATION.md as the one remaining
live-test item for this feature.

## 2026-08-13 (deploy prep) — First git commit ever for this repo, plus closing real deploy-doc gaps

User asked to get everything ready to host. Found a real blocker doing that: **this repo had never
been committed to git at all** (`git log` came back "does not have any commits yet") — the
existing `deploy/README.md`'s `git clone <your-repo-url>` step assumed a pushed repo that didn't
exist. Checked for secrets before staging (grepped for hardcoded keys/tokens — none found,
everything goes through `process.env.*`; confirmed `.env` itself is gitignored and wasn't staged)
and made the first commit — 71 files, everything except `node_modules`/`dist`/`.env`/logs/voice
models. **No remote configured and none pushed** — that needs a real decision (GitHub? self-hosted
git?) this session isn't making unprompted.

Also closed two real gaps in the deploy docs while in there:
- `deploy/README.md` never covered Postgres at all (flagged as a known gap since the CAD
  integration landed) — added a step installing/enabling it and creating the `delta_city_app`
  role + `delta_city` database, matching local dev's trust-auth setup. Flagged the real open
  question explicitly rather than guessing: is this VM's own Postgres the one both the bot and
  the CAD website end up pointing at, or does the CAD move somewhere else entirely — pick one
  before this matters, don't end up with two silently-diverging databases.
- `deploy/delta-city-dispatch.service` had no crash-loop protection — `Restart=on-failure` +
  `RestartSec=5` alone would restart forever every 5s against a persistently broken config
  (bad `DATABASE_URL`, expired token), hammering Postgres/Discord/ER:LC and flooding the journal.
  Added `StartLimitIntervalSec=60` / `StartLimitBurst=5` so systemd gives up and marks the unit
  failed after 5 attempts in a minute instead.

README.md was also stale in a few places that would mislead anyone deploying from it: still said
"SQLite schema" (migrated to Postgres 2026-08-10), test count said 62 (actually 119), and
referenced a `pythonBridge.ts` file that doesn't exist (`ttsServer.ts`). Fixed, and added the
newer pollers (`joinReminder.ts`, `roleplayHints.ts`, `modCallDetector.ts`) and `internalApi.ts`
to the project-structure list.

## 2026-08-11 (hardening) — `/internal/announce`'s secret check wasn't timing-safe

`internalApi.ts` compared `X-Internal-Secret` against `INTERNAL_API_SECRET` with plain `!==` — leaks
timing information proportional to how many leading characters match. Usually theoretical over a
real network (jitter dominates at that scale), but this endpoint shares the same Express app/port
as the webhook route, which is exposed through a public Cloudflare tunnel (see
`NEEDS_HUMAN_VERIFICATION.md`) — it's not localhost-only, so this isn't purely academic. Switched
to `crypto.timingSafeEqual` with an explicit length check first (it throws on mismatched-length
buffers otherwise, so the length check has to be a real branch, not just wrapped in a try/catch).
Smoke-tested all four cases against the live endpoint after restart: wrong secret → 401, missing
header → 401, correct secret + missing message → 400, correct secret + valid message → 502 (the
existing, already-documented IP-allowlisting blocker — unrelated to this change, confirms auth
itself still passes through correctly). tsc clean, 119/119 tests passing.

## 2026-08-11 (real bug, #3) — `/callsign manage`'s button panel had no error handling at all

Different bug class from the previous two: `commands/callsign.ts`'s `handleManage` uses a message-
component collector (`collector.on("collect", ...)`) for its department/rank/assign/remove panel —
this runs as its own event listener, entirely separate from `discordBot.ts`'s top-level
`interactionCreate` handler, which is the ONLY place in this codebase with a try/catch around
command logic (added specifically because an uncaught error there once crashed the whole process
live). The manage-panel collector had no equivalent. Concretely: if `assignCallsign` ever hit its
real `PRIMARY KEY (department, number)` constraint (two admins racing to assign the same
lowest-free number to two different people at once) — or any other transient Discord/DB error —
after `i.deferUpdate()` had already been called, the error would become an unhandled rejection
inside the listener. Caught only by the process-wide safety net (logs, keeps the process alive),
but the admin's ephemeral panel would be left stuck on "thinking..." forever with zero explanation
of what happened. Wrapped the collector body in the same try/catch shape `discordBot.ts` already
uses (report back via `editReply` if already deferred/replied, `reply` otherwise; never let the
error-recovery attempt itself throw uncaught). tsc clean, 119/119 tests passing, bot restarted.
No live trigger for this confirmed yet — flagging as another live-test item, not a "definitely
happened" bug like the previous two, but a real gap either way.

## 2026-08-11 (real bug, #2) — `/link` replied before the verify code was actually saved — another missing `await`

Same bug class as the `/bolo` fix below, different file: `commands/link.ts` called
`createVerifyCode` (async, `Promise<void>`) without `await`. Since the function wasn't used in a
boolean check this time, it didn't break a permission gate — instead it's a race condition: the
"In-game, type: `;verify {code}`" reply could reach the user before the INSERT into
`verify_codes` actually landed, so a fast (or just unlucky-timing) user typing the command
in-game immediately could hit `consumeVerifyCode`'s "unknown-code" path even though they did
everything right. Worse, if the INSERT ever failed (DB hiccup), the user would still get a
success-looking reply with a code that was never stored, and every subsequent attempt would fail
with no indication why. Grepped every async `db.ts` export against its call sites across the
whole codebase (`select:` search over all 24 exported async functions) — this was the only other
floating-promise call, `/bolo`'s was the first. Fixed with `await`. tsc clean, 119/119 tests
passing, bot restarted.

## 2026-08-11 (real bug) — `/bolo`'s "must be linked" gate was completely broken — missing `await`

Found during another self-review pass: `commands/bolo.ts` called `findLinkByDiscordId` (async,
returns `Promise<LinkRow | undefined>`) without `await` — `const link = findLinkByDiscordId(...)`.
A `Promise` object is always truthy, so `if (!link)` could never be true, meaning **any Discord
member could run `/bolo` regardless of whether they'd ever linked their account** — the intended
gate silently did nothing since this feature existed. `tsc --noEmit` doesn't catch this class of
bug (syntactically valid, no type error, just a boolean check on the wrong type) — this project has
no ESLint config at all, so nothing was set up to catch it either; `@typescript-eslint/no-floating-promises`
would have flagged it immediately if it existed here. Worth considering adding ESLint with that rule
at some point, not done as part of this fix (didn't want to introduce new tooling/dependencies as a
side effect of a one-line bug fix). Grepped the rest of the codebase for the same
`const x = someAsyncDbCall(...)` pattern — this was the only occurrence, everywhere else correctly
awaits. Fixed with a one-word `await`. tsc clean, 119/119 tests passing, bot restarted.

## 2026-08-11 (self-review) — Fixed a real spam gap in `;mod` found by re-reading my own code

Per the standing "never stop building" instruction, used a quiet coordination tick to re-review
recently-added code rather than wait for new asks. Found: `;mod`'s cooldown (7s) only throttled
the drag/PM/log actions, it didn't stop someone already tracked as "waiting for a mod" from
re-triggering the whole flow every 7s — each re-trigger re-PM'd them and posted a fresh duplicate
"is waiting" line to server-management, which would flood staff with noise for what's really the
same still-open call. Fixed: `handleMod` now checks `waitingForMod` first (still behind the
cooldown gate) and replies with a distinct "you're already in the queue" message instead of
re-running the whole flow. tsc clean, 119/119 tests passing, bot restarted.

## 2026-08-11 (item #3) — Mod call flow: `;mod` → staff waiting room, `/mod arrived` → mod scene

Completes the 5-item ask. User confirmed no known real ER:LC event exists for "a mod teleported to
a player" ("i dont know, you research it" / "i know its possible ive seen it done before") —
checked `BRIEF.md` and the parsed event shapes actually observed live; ER:LC's webhook only
documents `CustomCommand` and the periodic probe, nothing teleport-related. Went with the
AskUserQuestion-confirmed fallback: a manual mod-confirm command, same pattern as the panic-call
self-declare fix.

**Flow**: player runs `;mod` in-game (`handleMod` in `chatCommands.ts`, cooldown-gated like
`;ss`/`;ts`) → dragged into `STAFF_WAITING_ROOM_VC_ID`, PM'd, logged to server-management, and
added to an in-memory `waitingForMod` map. A staff member runs `/mod arrived player:<user>` once
they've actually reached the caller in-game → both get dragged together into the first empty
**existing** `STAFF_SCENE_VC_IDS` channel (realized this pool is already exactly "an available mod
scene" — `;ss` already does "drag into first empty staff scene channel," so no new channel ID was
needed for that half).

**Two things still genuinely unconfirmed, left as safe placeholders rather than guessed values**:
- `STAFF_WAITING_ROOM_VC_ID` — no real channel ID exists yet. Left `undefined` (not a fabricated
  snowflake); `;mod` detects this and no-ops with a clear warning + tells the caller to ping staff
  directly, instead of silently failing or dragging into the wrong channel.
- `MOD_CONFIRM_ROLE_IDS` — who's allowed to run `/mod arrived` is unknown; no dedicated "moderator"
  role constant exists anywhere in this codebase (only department-leadership ones). Reused
  `DISPATCH_ADMIN_ROLE_IDS` as the closest already-vetted trust tier rather than invent a new
  unconfirmed role ID — flagged for the user to confirm or correct.

tsc clean, 119/119 tests still passing (no new unit tests — this is Discord-interaction-heavy code
in the same vein as the other slash commands, which also aren't unit-tested; see
NEEDS_HUMAN_VERIFICATION.md for the live-test plan instead). Bot restarted, `/mod` confirmed
registered alongside the existing 5 slash commands.

## 2026-08-11 (newest) — 3 of 5 items from the user's newest ask: join-code reminder, roleplay hints, RCMP/BCHP compliance retiming

Per the division-of-labor post in COORDINATION.md, starting on the unambiguous parts of the
5-item request while the two genuinely open questions (mod-call VC channel IDs, whether a real
ER:LC "mod teleported" event exists) stay open pending user input.

**Item #1 — join-code reminder (`src/joinReminder.ts`)**: every 3 minutes, every online player
with no `links` row gets PM'd the join code (`ZMKNFxzNTX`, `DISCORD_JOIN_CODE` in `config.ts`) to
link their account. No tracking/grace-period state — just a recurring nudge every poll until they
run `;verify`.

**Item #2 — roleplay-quality hint broadcaster (`src/roleplayHints.ts`)**: every 7 minutes, a
random hint from a canned list is sent via in-game PA. The user named two example categories (GTA
driving, liveries) and said "and more" — the list covers those two plus several other common
ER:LC roleplay-quality issues (powergaming, metagaming, radio discipline, etc.). Wording beyond
the two named examples is this codebase's own inference, not user-dictated — flagged in
`NEEDS_HUMAN_VERIFICATION.md` for review. Deliberately PA-only, not spoken through the active
voice dispatcher — dispatch radio is reserved for LEO-operational traffic, a general RP-quality
PSA doesn't belong there.

**Item #4 — RCMP/BCHP compliance retiming + exact-callsign match (`complianceRules.ts` /
`complianceMonitor.ts`)**: two real behavior changes, not just retiming:
- RCMP/BCHP used to enforce immediately with no grace period. Now shares Delta PD's exact 2min
  soft-PM / 6min-threshold shape (`decideComplianceAction` unified into one department-generic
  function), but the hard-repeat cadence past the threshold is 1min (`SHERIFF_HARD_REPEAT_INTERVAL_MS`),
  not Delta PD's 2min — per the user's explicit numbers.
- `isCompliant` now takes an optional `assignedNumbers` param — RCMP/BCHP compliance means
  "matches the specific callsign CAD has on record for you" (queried from the shared `callsigns`
  table via the player's Discord link), not just "any number in your rank's valid range." An
  unlinked sheriff-team player has no CAD record to check against, so they're now always flagged
  as non-compliant rather than silently passing the old range check — this is the actual gap the
  user's #4 ask was about closing. Delta PD is unaffected (still self-chosen in-game, range check
  only, no CAD-assigned number to compare against).
- Post-load PM for sheriff team now sends the *same* message as the pre-load nag ("update your
  callsign to match your CAD record"), per the user's explicit "pmed the same message" — distinct
  from Delta PD, which keeps its own separate pre-/post-reload wording (unchanged, not part of
  this ask).

**Item #5 — exemption role (`complianceMonitor.ts`)**: RCMP/BCHP holders of role
`1535866581853413383` (`SHERIFF_COMPLIANCE_EXEMPT_ROLE_ID`) are checked first, before any tracking
state accumulates — a live Discord role lookup per poll (not cached, since exemption needs to
reflect role changes immediately).

2 new tests added for the retiming (grace period now applies, 1min hard-repeat is genuinely
faster than Delta PD's 2min) + 2 for exact-callsign matching. 119/119 tests passing, tsc clean,
bot restarted and confirmed healthy with both new pollers running
(`[join-reminder] started, polling every 3min`, `[roleplay-hints] started, broadcasting every
7min`).

**Still open, not started**: item #3 (mod call → staff waiting room → mod scene VC) — genuinely
blocked on the user providing real Discord VC channel IDs and confirming whether a real ER:LC
"mod teleported to player" event exists, per the two open questions flagged in COORDINATION.md.

## 2026-08-11 (much newer still) — Phrasing-tolerance fixes per BOT_SIDE_INSTRUCTIONS.md #9's exact spec

The CAD session's #9 (which arrived describing the exact feature already built above) included the
user's verbatim example phrasings, which exposed two real gaps against my own initial version:

- **"1500 show me en route to postal 2171" has no literal "call" word; "1500's en route to that
  call at 2171" has no "postal" word AND no "status"/"show" signal word.** Neither would have
  matched the original implementation. Fixed: postal detection now accepts bare "at N" as well as
  "postal N" (both `matchStatusUpdate` and `matchAttachToCall`), the literal word "call" is no
  longer required before attempting a postal-based attach, and "enroute"/"on scene" no longer
  require a "status"/"show" signal word at all (specific enough dispatch terms to stand alone) —
  only "available"/"unavailable"/"busy" still need one, since those are common enough English words
  to risk false-triggering on unrelated chatter otherwise.
- **Per the spec's explicit instruction** ("if no open call exists at that postal, say so instead
  of silently failing"): the status+postal scenario now reports absence rather than self-declaring
  when nothing's on file — different from `matchAttachToCall`'s "attach me to the panic" scenario,
  which still self-declares. The distinction: "the call at postal X" presumes an existing call,
  while "attach me to the panic" is explicitly about reporting something dispatch has no record of.
  Postal-based call-attach is now also only attempted for enroute/on_scene/busy — not
  available/unavailable, which imply NOT working a specific call.

4 new regression tests directly using the spec's own example phrasings (not paraphrased), plus one
for the report-absence behavior — 116 total, all passing. Typecheck clean, bot restarted and live.

## 2026-08-11 (much newer) — Voice dispatcher: real status tracking + self-declared calls (panic fix)

Two related requests, both about making the rules engine actually smart rather than just
acknowledging and forgetting. Big change in behavior, not just new features — see below.

**Status updates now persist, not just echo back.** "1500 to dispatch show me 10-8" used to either
fall through unrecognized or (after today's earlier fix) explain what 10-8 *means* — neither
actually changed anything. Now it maps directly onto the CAD's own 5-state duty-status model
(`available`/`unavailable`/`busy`/`enroute`/`on_scene`, see `delta-city-cad/src/lib/unitStatus.ts`)
and writes into the exact `live_units.status`/`call_id` columns the CAD's own Unit Manager UI
already reads — so a status called out over the radio shows up live on the CAD dashboard, not just
as a spoken ack. 10-code mapping: 10-8→available, 10-7→unavailable, 10-6→busy, 10-97→enroute,
10-23→on_scene. Plain English works too ("show me busy", "status is enroute"). "Available" always
clears `call_id` (done with whatever call they had); other statuses only touch `call_id` if the
utterance actually named a call, so "show me busy" mid-call doesn't silently detach someone.
**Behavior-changing correction**: earlier today "show me 10-8" was wired as a *definition* query
("10-8 is In service") — that was wrong. Real radio convention: saying a code bare is a status
*report*, not a request to look up what it means. Only explicit question phrasing ("what's 10-8,"
"what does 10-8 mean") still gets the definition. Updated 9 existing tests that asserted the old
(wrong) behavior — not preserved for compatibility, since the old behavior was the actual bug.

**"Attach me to X" now also works by postal, and self-declares the call if dispatch has nothing on
file** — directly fixes: "100 to dispatch attach me to the panic at postal X" used to fail outright
since dispatch had no matching call by description or case number (nothing ever populates a
"panic" call — ER:LC panic events have never been confirmed to even exist as a webhook event, see
`NEEDS_HUMAN_VERIFICATION.md`, so waiting on that arriving automatically isn't a real fix). Now: if
a postal is given and a real call already exists there, attach to it as before. If nothing's on
file, **the reporting officer's own transmission becomes the call record** — a new call gets
created (`source='leo'`, distinguishing it from ER:LC-sourced and CAD-originated calls), broadcast
to RTO text + in-game PA (not also spoken through this same voice session — would collide with the
direct response about to be spoken back to the same officer on the same audio player), and the
reporting unit gets attached to it immediately. Other units can then attach to the *same* call by
postal, case number, or description, same as any other call — it's a real row in `calls`, not a
special case. New `findActiveCallByPostal`/`declareCallFromVoice` in `callDispatch.ts`, `declareCall`
threaded through `IntentContext`/`RadioDependencies` same as every other DB-touching field this
session. Attaching to a call by any method (description, case number, or postal) now also sets
status to `enroute` automatically — this was already implied by the existing "is now enroute to
postal X" response text, now it's actually persisted too.

Every call response now includes the case number in the spoken text ("...postal X, case number
Y"), not just the postal — consistent with how new-call announcements already do this, and useful
since case number is how you'd reference it later.

Coordinated with the CAD-side session in `COORDINATION.md` before this shipped, since it's now a
second writer into `live_units.status`/`call_id` alongside their own Unit Manager UI.

12 new tests (112 total, up from 107), typecheck clean, bot restarted and live.

## 2026-08-11 (yet newest) — `/internal/announce` now speaks through the voice dispatcher too

CAD-side session (BOT_SIDE_INSTRUCTIONS.md #8) asked whether `/internal/announce` (used by their
Panic/Traffic Stop/911 flows) should also speak through the voice dispatcher, not just ER:LC's
in-game PA. Went with **always both, no per-message distinction** — matches the existing pattern
for every other announcement in this codebase (BOLO, pursuit, new-call, call-cleared already do
text + PA + voice). `internalApi.ts` now calls `speakToActiveDispatcher` alongside `announcePA`;
safe no-op if no voice session is currently enabled, so this can't break anything for existing
callers. No request/response shape change.

Also corrected a real misunderstanding on the CAD side while replying: their #8 asked me to "start
Phase 3 (the voice dispatcher)" as if it didn't exist yet. It's been built and live-tested
extensively already, well before tonight's integration work — see every earlier 2026-08-10 entry
in this file. Told them plainly rather than silently starting a duplicate/parallel build, and asked
them to relay the correction to the user directly so nobody ends up thinking voice hasn't been
worked on.

Typecheck clean, all 107 tests pass, bot restarted and live.

## 2026-08-11 (newest) — `/callsign self-assign` now derives the number from live ER:LC, no free-typing

User instruction, relayed via `COORDINATION.md`: "dpd callsigns based off of ingame callsigns only
please" — a blanket policy, not scoped to just the CAD's onboarding UI. The CAD's own onboarding
was updated to this rule first (auto-fills + locks the field to `live_players.callsign`, blocks if
offline); this brings `/callsign self-assign` in line so both entry points enforce the same rule
instead of one being strict and the other letting anyone free-type any 400-499 number.

- **Removed the `number` argument entirely** — the old flow took a typed integer, checked range +
  uniqueness, and assigned it. Asking for a number that then just has to exactly match their live
  callsign would be redundant, so the command now just reads it directly: looks up the caller's
  linked Roblox username, checks `live_players` for that username within the last 90s (same
  "online" threshold the CAD's onboarding uses), validates the live `callsign` field is a real
  400-499 number, and assigns exactly that.
- Rejects clearly at each failure point: not linked → "link your account first"; not online in the
  last 90s → "get in-game, then run this again"; live callsign isn't a valid Delta PD number →
  states what it currently is and what range is required. Uniqueness is still checked as a safety
  net even though the number no longer comes from free-typing (two people could plausibly report
  the same live callsign momentarily).
- New `getLivePlayerByUsername` in `db.ts` (case-insensitive, matching the CAD's own lookup
  convention). Caught and fixed a type mismatch while building this: `pg` parses `timestamptz`
  columns into JS `Date` objects automatically, not strings — had `LivePlayerRow.updated_at` typed
  as `string` initially, which would've been a real bug the first time `.getTime()` got called on
  it (works fine on a `Date`, throws on a `string`). Caught before it shipped, not after.
- This was flagged proactively, not requested outright — the CAD's session said "no bot-side
  changes needed" for its own onboarding update, but checking `handleSelfAssign` against the new
  policy found a real inconsistency between the two entry points. Posted it to `COORDINATION.md`
  with two options rather than guessing; the user's blanket instruction (relayed back) confirmed
  option 1 (bring the command in line) was the intent.
- Typecheck clean (including TS 4.4+'s aliased-condition narrowing correctly handling the
  `livePlayer && ...` online check without an explicit non-null assertion), all 107 tests pass, bot
  restarted with the updated slash command registered live.

## 2026-08-11 (later still) — `live_players`: broader live-state mirror for the CAD (BOT_SIDE #6/#7)

CAD-side session flagged two related gaps: (#6) Delta PD onboarding wants to validate against a
player's actual live in-game callsign, but there's a chicken-and-egg problem — `live_units` is
keyed by *assigned* callsign, and onboarding is exactly the moment before that assignment exists.
(#7) more generally, the CAD wants a broader live-state table (every online player, not just
assigned-callsign holders; split numeric coordinates for map/distance math; wanted stars) instead
of coming back with narrow one-off asks every time a new feature needs one more field.

Both are solved by one new table, `live_players` — every online player gets a row (civilians and
unlinked players included, not just ones matching a known department), upserted every 30s by
`complianceMonitor.ts`'s existing poll loop (no new poller — it already calls `getServerPlayers()`
every pass, this just runs before the department-gated logic so nobody gets skipped). Columns:
`roblox_username` (PK), `roblox_user_id`, `team`, `callsign` (live in-game field, independent of
any bot-assigned one), `postal`, `location_x`/`location_z` (separate numeric columns this time,
unlike `live_units.location`'s combined string — the stated reason for wanting them split was map
pins/distance math, which needs real numbers), `wanted_stars`, `updated_at`.

No "online" boolean — a row only gets touched when that player is actually in a live poll result,
so "online right now" reads as "`updated_at` is recent" (same convention `live_units` already
uses via its own staleness). Posted the shape back to `COORDINATION.md` so the CAD session doesn't
have to guess before wiring it up.

Typecheck clean, all 107 tests pass (Discord/DB-layer code, no dedicated tests, consistent with
the rest of this integration work), bot restarted and confirmed live — table exists, health check
passes.

## 2026-08-11 (later) — `/callsign manage` can remove a single callsign, not just all of them

Follow-up to the Ownership addition above — now that someone can hold more than one callsign at
once (e.g. RCMP + Ownership), the "Remove Callsign" button in `/callsign manage` needed to stop
meaning "wipe every department this person holds." It now removes only whichever department is
selected in the same dropdown already used for reassignment (asks the admin to pick one first if
they haven't). Also fixed the nickname side effect: it used to always blank the nickname on
removal — now only does that if the removal left them with zero callsigns; if they still hold one
in another department their nickname is still accurate and gets left alone.

`removeCallsignsByDiscordId` (the old wipe-everything function) had no remaining callers anywhere
in the codebase after this, so removed it from `db.ts` rather than leave it dead. Typecheck clean,
all 107 tests still pass, bot restarted and live.

## 2026-08-11 — Ownership callsigns (100-199), cross-department

New "Ownership" rank, requested for `/callsign assign`: 100-199, not tied to a specific department
(RCMP/BCHP/Delta PD callsigns are unaffected — Ownership stacks alongside whatever a person already
holds, it doesn't replace it). Modeled as a pseudo-department ("ownership") in `config.ts` so it
reuses the existing admin-assign/range-validation code path rather than a parallel one.

- **Interpreted "assign people with directive role an ownership rank" as an eligibility gate**: the
  *target* of the assignment must already hold the Community Directive Discord role — Ownership
  identifies people who already have that standing, it's not a promotion path. New
  `targetHasDirectiveRole` check in `commands/callsign.ts`, applied in both `/callsign assign` and
  the `/callsign manage` panel's confirm-assign button. If this reading is wrong (e.g. it was meant
  as "any Directive-tier admin can assign this, to anyone" rather than a target-eligibility rule),
  easy to flip — say so and it's a small change.
- **Fixed a real bug this surfaced in `/callsign manage`**: its reassign flow called
  `removeCallsignsByDiscordId` (removes a person's callsigns in *every* department) before
  assigning the new one — fine back when one person only ever held one callsign, but now that
  Ownership is meant to coexist with a department callsign, that would've silently deleted someone's
  RCMP/BCHP/Delta PD callsign the moment an admin gave them Ownership through the panel. Scoped to
  the new `removeCallsignForDepartment` (already existed for Delta PD self-assign) instead — only
  touches the department actually being reassigned.
- `/callsign assign` (the direct slash-command path) already never removed anything before
  inserting, so it was unaffected by that bug — this only applied to the interactive `manage` panel.
- Typecheck clean, all 107 existing tests still pass (no dedicated tests for this — it's
  Discord-command-layer code, consistent with the rest of `commands/*.ts` having no unit tests of
  its own). **Never tested live** — see `NEEDS_HUMAN_VERIFICATION.md`.

## 2026-08-10 — CAD integration: Postgres migration + all 5 BOT_SIDE_INSTRUCTIONS.md items

The `delta-city-cad` website (a separate Claude Code session, `/Users/Test/delta-city-cad`) needs
to share live data with this bot. Worked through its `BOT_SIDE_INSTRUCTIONS.md` end to end,
coordinating with that session in real time via a new `COORDINATION.md` in that repo.

- **#1 — Migrated `src/db.ts` from `node:sqlite` to `pg` against a real shared Postgres.**
  Installed Postgres 16 via Homebrew (`brew services start postgresql@16`), created a `delta_city`
  database and `delta_city_app` role (no password, local trust auth — consistent with this
  project's zero-cost/self-hosted posture throughout). `DATABASE_URL` set in both repos' env files.
  Every exported `db.ts` function is now async (a real network round-trip, not an in-process call)
  — this rippled through nearly every file that touches the database: `chatCommands.ts`,
  `complianceMonitor.ts`, every `commands/*.ts`, `callsignDutyTracker.ts`, `callDispatch.ts`,
  `pursuit.ts`, `nearestUnit.ts`, `voiceSession.ts`'s `radioDeps` wiring, and — because the voice
  dispatcher's rules engine calls straight into these — `radioSession.ts`'s `IntentContext`/
  `RadioDependencies` types and every `radioIntents.ts` matcher that touches them
  (`matchTrafficStopReport`, `matchAttachToCall`, `matchPlateCheck`). Fixed a latent bug this
  surfaced: `matchIntent`'s matcher loop checked `if (result)` on an un-awaited call, which is
  always truthy for a Promise — harmless while every matcher was sync, would have silently broken
  the moment any of them went async. Now properly `await`s every matcher regardless of whether it's
  sync or async. Table shapes match `delta-city-cad/src/db/schema.ts` exactly (including keeping
  `text`-typed timestamp columns rather than switching to native `timestamp`, per that schema's own
  comments). One-time migration script (`scripts/migrateSqliteToPostgres.ts`) copied the real dev
  data across (5 links/callsigns after merging with the CAD's own mock seed rows, 4 calls) —
  idempotent, ON CONFLICT DO NOTHING throughout, safe to re-run.
- **#2 — Extended `calls` with CAD-required columns, added `call_notes`.** Done as part of #1's
  schema pass. `recordNewCall` now explicitly sets `source='erlc_native'` (the CAD's schema has no
  DB-level default for that column). `markCallCleared` now also sets `status='cleared'`.
- **#3 — New `live_units` table, upserted by the existing duty poller.** No new poller —
  `callsignDutyTracker.ts`'s existing 60s loop already fetches the full player list and iterates
  every assigned callsign, so it now also upserts one `live_units` row per callsign each pass
  (`on_duty`, `postal`, `location`, `roblox_username`), including `on_duty=false` for
  currently-offline callsigns so `updated_at` still reflects freshness.
- **#4 — `POST /internal/announce`.** New `src/internalApi.ts`, mounted in `index.ts`, wraps the
  existing `announcePA()`. Checks `X-Internal-Secret` against a new `INTERNAL_API_SECRET` env var
  before touching anything else. Confirmed working end-to-end live: 401 on a missing/wrong secret,
  and with the correct secret it correctly reaches `announcePA` and surfaces the (pre-existing,
  already-tracked) ER:LC IP-allowlist 403 rather than crashing or hanging.
- **#5 — `/callsign self-assign`.** New subcommand, Delta PD only, no admin gate (matches the
  brief: Delta PD is unwhitelisted and self-chosen, unlike RCMP/BCHP's admin-assigned flow). Writes
  the exact same `callsigns` row shape as the CAD's temporary self-registration path
  (`department='delta-pd'`, `rank='Officer'`, `assigned_by=<self>`), so the two don't diverge into
  separate sources of truth. New `removeCallsignForDepartment` in `db.ts` — scoped to one
  department, unlike the existing `removeCallsignsByDiscordId`, so reassigning a Delta PD number
  can't accidentally wipe out an unrelated RCMP/BCHP callsign the same person might hold. Decided
  (flagged, not unilaterally imposed — see `COORDINATION.md`) to keep the CAD's self-registration
  path as a fallback rather than asking for its removal, since both enforce the same
  `(department, number)` uniqueness constraint with no real conflict risk.
- 107/107 tests still passing (no test needed the real Postgres connection — the whole
  `radioSession`/`radioIntents` suite runs against fixtures, unaffected by the storage swap
  underneath), typecheck clean, server restarted and confirmed live against real Postgres
  (`[db] Postgres schema ready` in the boot log).

## 2026-08-10 — Full feature audit against the brief (everything except the dashboard)

User asked to build out everything else in the brief that isn't the CAD dashboard (they're
integrating that themselves). Audited every module against `BRIEF.md`'s feature list and
requirements. Most of it was already built and solid — three real gaps found and fixed:

- **Discord nickname sync for Delta PD's self-chosen callsigns.** The brief says "once on a valid
  callsign, Discord nickname becomes `[callsign] | [username]` — same format for every department."
  `/callsign assign` already did this for the RCMP/BCHP admin-assigned flow, but Delta PD callsigns
  are self-chosen in-game with no bot command involved at all — nothing was ever syncing their
  nickname when they picked a valid one. `complianceMonitor.ts` is the only place that ever
  observes a Delta PD officer going compliant, so that's where this now lives
  (`syncCompliantNickname`). Gated behind `COMPLIANCE_ENFORCEMENT_ENABLED`, same as the rest of the
  monitor — it depends on `TEAM_TO_DEPARTMENT`'s Team-name mapping, which is still unconfirmed
  against real data, and a wrong guess there would visibly rewrite a real member's nickname on the
  live production server.
- **Pursuit announcements now use OUR assigned callsign, not ER:LC's raw in-game field.**
  `pursuit.ts` was reading `player.Callsign` straight from the live ER:LC API — for RCMP/BCHP that's
  just whatever the player happened to type in-game, not necessarily what `/callsign assign` gave
  them. Every other part of this codebase (especially the voice dispatcher, after a lot of live
  iteration this session) treats our own DB assignment as the real source of truth. Fixed
  `currentCallsignAndPostal` to check `findLinkByRobloxUserId` → `getCallsignsByDiscordId` first,
  falling back to ER:LC's field only if unassigned. Also split pursuit announcements into a spoken
  variant (NATO-digit callsign/postal, via `formatForSpeech`) vs. the text/PA variant (literal) —
  it was sending the same unformatted string to all three channels, so Piper would've read "1247"
  as "twelve forty-seven" instead of digit-by-digit, the exact issue already fixed everywhere else
  this session.
- **Call-cleared announcements now go to all three channels, not just two.** New-call announcements
  (`announceNewCall`) already hit RTO text + in-game PA + voice; the call-cleared counterpart was
  only doing RTO text + voice, silently missing the PA announcement. Also gave it the same
  spoken-vs-literal case-number split as everywhere else.
- Everything else audited and found already correctly built: `;ss`/`;ts`/`;scene`/`;team`/`;ps`
  (permission gating, cooldowns, silent-ignore for unlinked/civilian, proximity matching), `;verify`
  linking flow, `/callsign assign|manage`, `/mylink`, `/bolo` (already speaks + NATO-formats
  plates), `/dispatch enable|disable`, callsign duty tracking, 429 rate-limit backoff on every ER:LC
  call, "dispatch data unavailable" messaging on API failure. Left alone (already correctly
  deferred, not gaps): panic event handling (ER:LC webhook event unconfirmed to even exist),
  traffic-stop-fleeing auto-detect (no known detection trigger), Melonly coexistence checkpoint
  (needs a human to check Melonly's own dashboard UI), Delta Fire (brief itself says not set up
  yet). 107/107 tests still passing, typecheck clean, server restarted with all three fixes live.

## 2026-08-10 — 10-code word-vs-digit fix (root cause of "always says please repeat") + AI fallback investigation

- **Root-caused and fixed why 10-codes basically never worked over voice.** Every 10-code check
  (`extractTenCode`, the 10-11 traffic-stop trigger, the 28/plate-check trigger, the "32" backup
  request) matched literal digit characters ("10-8"), but confirmed via real server logs that Vosk
  transcribes spoken codes as WORDS ("ten eight," "ten dash eight," "ten twenty eight") — so almost
  every real 10-code utterance silently missed and fell all the way through to "10-9, please
  repeat," no matter what was said. New `normalizeForTenCode` in `radioIntents.ts`: word→digit via
  the existing `normalizeSpokenDigits`, then merges a spoken compound two-digit number that comes
  out as two separate tokens ("twenty"+"eight" → "20" "8") back into one ("28") — needed for codes
  like 10-28/10-32 read as one compound word. Deliberately does NOT merge "10" itself as a tens
  value, so digit-by-digit code reading ("ten eight" → 10-8) isn't broken by the same logic that
  fixes compound reading ("ten twenty eight" → 10-28). Applied everywhere a 10-code is matched:
  `extractTenCode`, the 10-11 trigger, the "28 when ready" trigger, the plate-check "28" trigger
  (both the presence check AND the value-extraction regex — normalizing only the trigger and not
  the extraction was an easy way to still miss it, caught by a test), and the "32"/additional-units
  backup trigger. 12 new regression tests locking in the exact real transcripts that failed live
  ("show me ten eight one zero five zero," "one zero five zero show me ten dash eight," etc.) — 107
  total, all passing.
- **Investigated an AI fallback for genuinely unrecognized utterances** (requested: smarter answers
  using real knowledge + live in-game context, instead of "please repeat" every time). Wanted free,
  so tried a local model via Ollama — installed, pulled `llama3.2:1b`, tested live. Not viable on
  this machine: a 5-token test request took over 5 minutes due to severe swap pressure (10.6GB of
  12GB swap already in use just from the existing STT/TTS/Node stack on 8GB of RAM). Wrote the
  fallback code anyway since it's genuinely ready to use once there's headroom (a hosted API, or
  the planned move to a dedicated VM): `src/ai/ollamaFallback.ts` + an optional
  `generateAiFallback` hook on `RadioDependencies`. **Deliberately not wired into production** —
  `voiceSession.ts`'s real `radioDeps` still omits it, so this is zero-risk/zero-behavior-change
  until a follow-up decision gets made. See `NEEDS_HUMAN_VERIFICATION.md` for the three options.
- Stopped the Ollama service (`brew services stop ollama`) so it isn't competing for memory with
  the actual dispatch bot in the meantime.

## 2026-08-10 — Case-number attach + live-testing fixes (10-code queries, handshake friction, listener leak)

- **"Attach to case #X" now works alongside description-based attach.** Officers can say "1050 to
  dispatch attach me to case #4521" (or "case number four five two one," spoken digit-words work
  too) for an exact match, instead of only fuzzy-matching against the crime description. New
  `findActiveCallByCaseNumber` in `callDispatch.ts`/`radioSession.ts`'s `IntentContext`/
  `RadioDependencies`; `matchAttachToCall` in `radioIntents.ts` checks for a "case #/number" phrase
  first and only falls back to fuzzy description matching if none is spoken. The spoken call
  announcement now also states the case number ("...case number four five two one.") so officers
  actually have something to reference.
- **Fixed: "show me 10-8" (and similar) fell through to "10-9, please repeat."** `matchTenCodeQuery`
  only triggered on "what/mean/means/code" — "show" wasn't a recognized query signal word. Added.
  Confirmed via real transcript in the server log.
- **Fixed: the #1 live-testing complaint — handshake required its own separate turn.** Real officers
  say the callsign, cue word, AND command all in one breath ("1500 to dispatch show me 10-8"), but
  the handshake matcher required an utterance that ended exactly at "dispatch," so anything after it
  got dropped and the whole thing fell back to a "say your callsign" hint — even though a valid
  handshake was right there. New `matchCallInPrefix` matches the handshake as a *prefix* and
  captures everything after it as `remainder`, which gets processed immediately in the same turn
  (`processActiveSpeakerCommand`, extracted from `handleTransmission` so both the normal path and
  the combined path share it) instead of forcing a "go ahead" round-trip first.
- **Bare cue word now works with no digits at all** — "dispatch" or "central" alone is a valid
  handshake. The spoken digits were already discarded and never used for identity (the real
  callsign always comes from `resolveCallsign(speakerId)`, i.e. who's actually on the Discord voice
  connection) — so requiring digits to be spoken at all was pure friction. "Central" added as a
  second valid cue word alongside "dispatch," since not everyone says "dispatch."
- **Widened leading-filler tolerance in the handshake matcher.** Real transcript "the one zero five
  zero dispatch" was rejected — only "hey/uh/um" were tolerated as filler before the callsign, not
  "the" (a common STT artifact). Added "the"/"so," and made it zero-or-more instead of one optional
  word.
- **Fixed a `MaxListenersExceededWarning` on the per-user `AudioReceiveStream`** — confirmed live
  after enough utterances from one speaker in a session tripped Node's default 10-listener cap.
  discord.js reuses the same stream instance per user across utterances rather than a fresh one each
  time; not an actual leak (the per-utterance `pipeline()` cleans up its own listeners), just a
  mismatch with the default cap for a long-lived stream. Bumped to 50 via `setMaxListeners`.
- 6 new tests (99 total).

## 2026-08-10 — Full 10-code list + traffic stop workflow (10-11 → plate → backup dispatch)

- **Replaced the earlier placeholder 10-code set (8 codes) with the full list provided** (10-0
  through 10-100, ~90 codes). This is a real, specified list now, not a generic BC/RCMP guess.
- **New handshake variant**: "{callsign} traffic stop when ready" (or just "traffic stop") works
  alongside the existing "{callsign} to dispatch."
- **Full traffic-stop workflow, matching the exact example given**:
  1. "I'll be on a 10-11 postal 910 highway 55 with a red 4-door sedan. 28 when ready" — extracts
     postal + vehicle description, opens a `traffic_stops` record, and since "28" (10-28, vehicle
     registration check) was flagged, immediately responds "28, go ahead."
  2. "28 reading ABC123" — recognized as a plate check specifically because a traffic stop is
     active (bare "28" outside that context is deliberately NOT treated as a plate trigger — too
     ambiguous with someone just saying "10-28" as a 10-code reference). Records the plate,
     responds with the NATO-phonetic plate + "Do you need additional units?"
  3. Answer routes through a new `pendingFollowUpTag` mechanism (see below) rather than the normal
     matcher order — "yes"/"32"/"affirmative" finds the nearest OTHER on-duty unit to the
     reporting officer's live position (excluding themselves — new `excludeRobloxId` option on
     `findNearestUnit`), assigns them (`traffic_stop_units` table), and announces "{nearest
     officer's REAL callsign}, attach and enroute to postal {x} to assist {original officer}."
     "No"/"negative" just logs solo. An ambiguous answer asks again rather than guessing — this
     dispatches a real unit if wrong, worth the extra confirmation.
- **New `pendingFollowUpTag` mechanism** (`IntentResult.followUpTag`, `RadioSessionState.
  pendingFollowUpTag`, `IntentContext.pendingFollowUpTag`): lets one turn's response mark what
  kind of answer it's expecting next ("additional-units"), so the following utterance routes
  straight to a dedicated yes/no handler instead of being re-interpreted as a fresh command.
  General-purpose — reusable for any future multi-turn exchange, not just this one.
- **`IntentMatcher`/`handleTransmission` are async now** — finding the nearest unit needs a live
  ER:LC API call, not just a DB read, so the whole matcher chain had to support that.
- **Light personality pass**: documented dispatch's "identity" as calm/efficient/professional in
  `radioIntents.ts`, and wrote the new traffic-stop responses with natural warmth ("Logged, be
  safe out there.") rather than robotic template concatenation. Left the already-tested core
  protocol phrases (10-4/10-9/go-ahead/please-hold) untouched — those were explicit exact-wording
  requests earlier this session, not worth relitigating now.
- New `traffic_stops` + `traffic_stop_units` SQLite tables, same CAD-readiness rationale as
  `calls`/`call_units`.
- 10 new tests (93 total), still zero real-database dependency in the pure-logic test suite.

## 2026-08-10 — Active-call announcements, "attach to call" voice command, CAD-ready persistence

New feature: officers can self-assign to in-game calls (robberies etc.) by voice, and it's now
persisted for the CAD dashboard the user is building separately.

- **Call announcements now use the requested phrasing and are spoken**, not just posted as
  Discord text: "all units be advised, active {crime} at postal {postal}." Goes to Discord text
  (fuller detail — call number, nearest unit), in-game PA, and the voice dispatcher if one's
  enabled. Postal is still a best-effort approximation (nearest unit's own postal — `ErlcCall` has
  no postal field of its own, and no live call has ever been observed to confirm one exists).
- **New "attach to call" voice command**: "1409 attach to the robbery" → matches against currently
  active calls by description, dispatch responds "{real callsign} is now enroute to postal {x}."
  (no "10-4, I understand" prefix — added a `skipAck` flag to `IntentResult` for intents that
  construct their own complete sentence, same pattern as the callsign handshake responses).
  Tolerant of the connector word being mangled/dropped, consistent with the handshake fix.
- **Persisted for the future CAD integration**: new `calls` and `call_units` SQLite tables — calls
  survive a bot restart (not just in-memory) and unit-to-call assignments are recorded with a
  timestamp. This is deliberately just the data layer for now; no API/export format built yet
  since the user is building their own CAD dashboard separately and will specify what it needs.
- **Real architectural fix, not just a feature add**: initially wired `matchAttachToCall` with
  direct imports of `callDispatch.ts`/`db.ts`, which would have made unit tests silently hit the
  *real* production `dispatch.db` — caught before running. Refactored to proper dependency
  injection instead: `IntentContext` now carries `findActiveCall`/`attachUnitToCall` as injected
  functions (same pattern as `CallsignResolver`), and `handleTransmission`'s growing parameter
  list got bundled into one `RadioDependencies` object rather than more positional args.
  `radioSession.ts`/`radioIntents.ts` stay fully pure and testable against fixtures; only
  `voiceSession.ts` wires in the real database.
- 10 new tests (83 total).

## 2026-08-10 — NATO phonetic alphabet for spoken plates

- Added `formatPlateForSpeech` to `speechFormat.ts` — full NATO alphabet (Alpha through Zulu),
  digits spoken as words, separators (dashes/spaces) dropped. Wired into the rules engine's plate
  check response (`radioIntents.ts`) and `/bolo`'s spoken output specifically — RTO text and
  in-game PA keep the literal plate string since those are read as text, not heard, only the
  actual spoken paths use the phonetic version.
- Verified with a real round trip (Piper → Vosk): "Alpha Bravo Charlie one two three" was
  pronounced clearly and re-transcribed back exactly right, high confidence.
- 4 new tests (77 total).

## 2026-08-10 — Real callsign lookup, smarter intent matching, real-time TTS, speak BOLOs/pursuits

Fourth round of live-testing feedback in one day, all addressed:

- **Dispatch now addresses speakers by their REAL assigned callsign, never the parsed digits.**
  `radioSession.ts`'s `handleTransmission` takes a new `CallsignResolver` — looks up the real
  callsign (or falls back to the linked Roblox username) by the speaker's actual Discord user ID,
  which the voice connection already gives us precisely. The spoken handshake phrase is now only
  used to detect that a call-in was *attempted* — never trusted for who's actually talking. This
  was a real correctness problem, not just cosmetic: garbled STT digits were being used to address
  people, which could easily address the wrong person or a nonsense number.
- **"Say again" is now "10-9, please repeat, {callsign}"** — matches real 10-code phrasing
  instead of a plain-English "say again."
- **Rules engine now extracts the most likely intent instead of demanding one exact phrasing.**
  Old matchers were `^status\s+(...)$`-style anchored patterns that rejected anything with filler
  words ("um", "can you", "for me") as flatly unrecognized. Rewrote all three (plate check, status
  update, 10-code query) to search for their key signal word anywhere in the transcript and pull
  the relevant payload from context, so "uh can you run a check on plate ABC123 for me" now works
  the same as "run plate ABC123." When a signal word is present but nothing usable follows (e.g.
  just "status" or "check a plate for me"), it now asks a natural follow-up instead of declaring
  the whole utterance unrecognized.
- **Response latency: found and fixed the second latency source.** TTS was still spawning the
  `piper` CLI fresh per response (reloading the ONNX voice every time), the same class of problem
  already fixed for STT. Found `piper-tts`'s direct Python API (`PiperVoice.load` +
  `synthesize_wav`) and built `tts_server.py` + `ttsServer.ts` as a persistent process — confirmed
  via direct timing: ~4s one-time load, then 0.5-2s per response afterward (down from a full
  reload every time). Warmed up at boot alongside the STT server.
- **BOLO and pursuit announcements now also speak through the active voice dispatcher**, not just
  Discord text + in-game PA. Extracted the active-session/speak state into a new
  `activeDispatcherRegistry.ts` specifically to avoid a circular import (`pursuit.ts` needs to
  speak; `voiceSession.ts` already imports `isPursuitActive` from `pursuit.ts`) — the registry has
  no dependency on either, so both can import from it safely. No-ops cleanly if no dispatcher
  session is currently active.
- Removed `pythonBridge.ts` (the old per-spawn TTS wrapper) — fully unused now that both STT and
  TTS go through persistent processes. `voice/tts_speak.py` itself is untouched, still the
  standalone test script.
- 7 new tests (73 total): real-callsign addressing, unassigned-unit fallback, 10-9 phrasing, and
  the fuzzy intent-matching cases (filler words, ambiguous signal-word-only utterances, status-vs-
  10-code-query precedence).

## 2026-08-10 — Handshake matcher too rigid: real speech (correctly) transcribed, then ignored

Second live round: text summaries now correctly showed what was heard ("fourteen one i
dispatch" for an attempted callsign handshake) but no spoken response ever followed — the
matcher only accepted individual digit words plus a literal "to", so real speech kept missing it
and idle-state misses are silent by design. Two fixes:

- `matchCallIn` now: (1) expands compound number words too ("fourteen" → "14"), not just single
  digits — real speech doesn't reliably stay digit-by-digit even when asked to; (2) treats the
  connector word before "dispatch" as optional/fuzzy (`to|too|i|a|uh|nothing`) instead of a rigid
  literal "to" — confirmed live that STT transcribed "to" as "i". On the exact real garbled
  transcript that prompted this ("fourteen one i dispatch"), it now extracts "141" — not
  necessarily what was actually said, but the protocol doesn't verify stated callsigns against a
  roster anyway (same as real radio dispatch), so best-effort extraction over silence is the
  right tradeoff here.
- **Idle-state misses that clearly mention "dispatch" now get a spoken hint** ("Say your callsign
  followed by dispatch...") instead of dead silence, which is what was making this feel broken
  rather than "waiting for the right phrasing." True unrelated chatter (no mention of dispatch at
  all) still stays silently ignored, per the brief's original spec.
- 4 new tests (66 total) covering the connector-word fuzziness, compound numbers, the exact real
  garbled transcript, and the new idle-hint behavior.

## 2026-08-10 — Male voice switch + self-tested real Discord playback

- **Switched Piper voice from `lessac` (female) to `ryan` (male)**, per request. Verified the
  switch actually did something (not just trusted the model name) with a local pitch check:
  ryan ~168Hz vs lessac ~179Hz, consistent with lower-pitched/male across multiple independent
  voice catalogs that list ryan as male, lessac as female.
- **Self-tested real Discord audio playback end-to-end** — joined an actual (confirmed-empty, to
  avoid disturbing anyone) voice channel with the live bot, synthesized a real phrase with the
  new voice, played it through `@discordjs/voice`, and watched the player state machine:
  Buffering → Playing → Idle, zero errors. This is the strongest evidence yet that the
  join/connect/synthesize/play mechanics are actually correct — something that was previously
  only typechecked, never run against a real Discord connection.
- Given that test passed cleanly, "it doesn't speak" was very likely the exact same root cause as
  "nothing happens" (the callsign handshake never matched due to the small STT model's poor
  accuracy on real speech, so `handleTransmission` returned `ignore` and `speak()` was never even
  called) — not a separate playback bug. The STT model upgrade + persistent server from earlier
  this session should address it; still needs a live human to fully confirm.
- Added permanent error/status visibility to the production voice code (not just my test script):
  `connection.on("error", ...)`, `player.on("error", ...)`, and Playing/AutoPaused state logging —
  previously a real playback failure would have been completely silent with no way to diagnose it.

## 2026-08-10 — Real bugs found from live testing, all fixed

First real live test of `/dispatch enable` + voice, and separately `/bolo`. Both surfaced real,
previously-invisible bugs:

- **`:h`-based commands (BOLO, pursuit PA) have been silently failing this entire time.** Real
  API error: `403 {"code":4000,"message":"You are not authorized to perform this action on this
  server. If you are creating your own custom bot, visit https://api.erlc.gg/server-owners to
  allowlist your IP address."}`. This server's outbound IP was never allowlisted with ER:LC —
  **needs the user to visit https://api.erlc.gg/server-owners and add it** (this dev machine's
  current IP: `173.180.215.120`; will differ again once deployed to the Oracle VM). Improved
  `erlcClient.ts`'s error handling to detect and clearly explain this specific 403 instead of a
  bare "failed: 403" — should be self-diagnosing next time it happens on a new IP.
- **Voice pipeline "did nothing" when spoken to** — root cause was STT accuracy, not a logic bug.
  Real transcripts of actual attempted callsign handshakes: "vance to dispatch" and "for it you
  know nine to dispatch" (both almost certainly attempts at "one four zero nine to dispatch").
  The small Vosk model (confirmed accurate only against clean synthetic `say`-generated audio
  earlier) badly mangles real human speech over a real mic/Discord audio path. Since a properly
  handled "ignore" (nothing matched the handshake) is silent by design, this looked exactly like
  "nothing happens" with zero visible cause.
- **New requirement, and it would have caught the above immediately:** every voice pipeline
  transmission now posts a text summary in the VC's own text-in-voice chat — what was heard, the
  confidence score, and what action was taken (or why nothing was) — in addition to speaking the
  response. `voiceSession.ts` now does this for every case: not linked, pursuit active, no
  transcript, and normal processed transmissions.
- **Substituted the small Vosk model for the accurate one** (`vosk-model-en-us-0.22-lgraph`,
  ~124MB vs ~40MB) since "sometimes transcribes real speech as basically-random words" makes the
  whole feature non-functional, which is exactly the kind of "impossible with the current
  approach" problem worth substituting rather than living with. Confirmed via the same round-trip
  testing method as before, on the same synthetic samples — same accuracy on clean audio (both
  correctly transcribe "one four zero nine to dispatch"), and the bigger model should meaningfully
  outperform the small one on real speech generally (its own real-world value proposition per
  Vosk's own model docs) even though the exact real utterances that failed live weren't saved to
  re-test directly (they get deleted after processing, same as ever).
- **That model takes 20s+ to load, which would make a fresh-process-per-utterance design
  unusable** (confirmed: one utterance would take 20-60+ seconds just to start transcribing).
  Adapted the architecture to match — built `stt_server.py` + `sttServer.ts`, a persistent Python
  process that loads the model once and stays alive, servicing transcription requests over a
  simple stdin/stdout JSON-line protocol instead of spawning fresh per utterance. Warmed up at
  bot startup (`warmUpSttServer()` in `index.ts`) so the load cost happens once at boot, not on
  someone's first sentence. `pythonBridge.ts` is TTS-only now; the old per-spawn STT path was
  removed rather than left alongside the new one (two ways to do the same thing invites using the
  wrong one later). Each transcription itself still takes ~5-6s to decode with this bigger model
  (real, worth knowing about — noticeable lag in a live exchange) — a real quality/latency
  tradeoff, not hidden.

## 2026-08-10 — /dispatch enable|disable (permission split from /callsign)

- Renamed `/dispatch start|stop` to `/dispatch enable|disable`, and `enable` now takes a required
  `voice_channel` option (channel-type-restricted to voice channels) instead of inferring it from
  the invoker's current VC.
- New `DISPATCH_ADMIN_ROLE_IDS` — Directors, Executive-tier, and Managers. Deliberately a
  different role set from `/callsign`'s `CALLSIGN_ADMIN_ROLE_IDS` (no Whitelisted Command, adds
  the Management tier that `/callsign` doesn't include).

## 2026-08-10 — @discordjs/voice wiring + confidence scores (Phase 3 scaffolding complete)

- Installed `@discordjs/voice` + pure-JS `opusscript`/`tweetnacl`/`prism-media` — deliberately
  avoided native-compiled options (`@discordjs/opus`, `sodium-native`) after `ffi-napi` had
  already proven native modules don't build on this Node 24 setup. `generateDependencyReport()`
  confirms opusscript + native AES-256-GCM crypto support cover everything needed, no native
  compile required.
- Built `src/voice/pythonBridge.ts` (spawns the venv's Python directly, no shell activation
  needed) and `src/voice/voiceSession.ts` — joins a VC, subscribes to per-speaker Opus audio
  (`EndBehaviorType.AfterSilence` handles utterance segmentation for free), decodes/resamples
  Opus→16kHz mono WAV via prism-media + ffmpeg, runs it through the same STT→state-machine→rules-
  engine→TTS pipeline already proven standalone, plays the response back. Gated to linked
  accounts only (mirrors the text-command permission philosophy) and respects
  `isPursuitActive()` (bot goes quiet in RTO during a pursuit, per the brief).
- Added `/dispatch start|stop` (Directive/Executive/WL Command gated) to control it.
- **Self-caught bug:** `tts_speak.py` initially called `piper` expecting it on PATH — works when
  manually `source .venv/bin/activate`'d, breaks when Node spawns the venv's python3 directly
  (no PATH change). Fixed by resolving the `piper` console-script relative to `sys.executable`
  instead. Caught by testing the actual Node→Python bridge, not just the Python scripts alone.
- **Self-caught bug #2:** built `speechFormat.ts` (digit-by-digit callsign formatting) but forgot
  to actually use it in `radioSession.ts`'s response text — callsigns were still going to Piper
  as whole numbers, defeating the point. Caught via the same round-trip bridge test. Fixed, and
  updated all the affected unit tests' expected strings.
- **Closed a gap same-session:** Vosk's `SetWords(True)` exposes real per-word confidence scores
  (confirmed: clean synthetic speech scores 1.0). Wired this through end-to-end — `stt_transcribe.py`
  now outputs `{text, confidence}` JSON (averaged across words), the Node bridge and
  `voiceSession.ts` pass it to `handleTransmission`. The low-confidence "say again" path is no
  longer unreachable dead code.
- Everything up to real Discord audio is proven (STT, TTS, round-trip, state machine, rules
  engine — 62 tests). `voiceSession.ts` itself has never seen real audio; exact test steps are in
  `NEEDS_HUMAN_VERIFICATION.md`.

## 2026-08-10 — Vosk (STT) + Piper (TTS) proven standalone, with real self-corrections

- **`vosk` npm package is broken on Node 24** — its `ffi-napi` dependency is unmaintained and
  fails to compile against current N-API (`napi_add_finalizer` signature changed). Pivoted to
  Vosk's own Python package (`pip install vosk`, uses `cffi`, has real prebuilt wheels) in a venv
  under `voice/`, called from Node via `child_process` when wired up. Downloaded the small English
  model (~41MB) and proved it with `voice/stt_transcribe.py` (WAV in, transcript out) against a
  synthetic speech sample generated with macOS `say` + `ffmpeg` (resampled to 16kHz mono PCM).
- **Piper's official GitHub release binary is mislabeled** — `piper_macos_aarch64.tar.gz` from
  the latest (2023.11.14-2, the project's binary releases have stalled since) actually contains
  an **x86_64** binary, and is also missing its `libespeak-ng.1.dylib` dependency entirely.
  Pivoted to the `piper-tts` PyPI package (from the actively-maintained OHF-voice/piper1-gpl
  fork under Home Assistant) instead — bundles its own ONNX runtime, no architecture headaches.
  Downloaded the `en_US-lessac-medium` voice (~63MB) from Hugging Face and proved it with
  `voice/tts_speak.py` (text in, WAV out).
- **Discovered a real accuracy issue via round-trip self-testing** (Piper's own output fed back
  through Vosk): saying a callsign as a whole number ("1409") gets synthesized as "fourteen-oh-
  nine"/"one thousand four hundred nine" and Vosk mis-transcribes whole-number callsigns the same
  way ("the thousand and four hundred and nine"). Saying it **digit-by-digit** ("one four zero
  nine") — which also happens to be the real radio convention — round-trips perfectly both
  directions. Fixed `matchCallIn` in `radioSession.ts` to normalize spoken digit-words before
  matching (still also accepts literal digit strings), and added `speechFormat.ts` so any future
  TTS text inserting a callsign formats it digit-by-digit.
- `voice/setup.sh` reproduces the whole environment (venv, pip deps, model downloads — all
  gitignored, large binaries) for whoever runs this next / a fresh clone.

## 2026-08-10 — Radio protocol state machine + rules engine (pure logic, tested)

- Built `radioSession.ts`: the half-duplex state machine exactly per spec — call-in handshake
  ("1409 to dispatch" -> "1409, go ahead"), one active speaker, FIFO hold queue for others keying
  up mid-exchange ("please hold" -> "go ahead" once the active exchange resolves), unrecognized
  phrases trigger "say again" without dropping the active speaker, recognized intents needing
  follow-up keep the exchange open. Added a confidence-gated path per the brief's "don't guess
  from a low-confidence transcript" — below `LOW_CONFIDENCE_THRESHOLD` (0.6, unconfirmed/untuned
  until real Vosk scores exist to calibrate against), it asks to repeat without even calling the
  intent matcher.
- Built `radioIntents.ts`: rules-engine pattern matcher for 10-code definition queries, status
  updates, and plate/BOLO checks (the last one always reports "nothing on file" — no persisted
  BOLO store exists yet to actually check against, noted rather than faked). 10-code list is a
  common BC/RCMP set, **unconfirmed against what this specific community actually uses**.
- 24 new tests (58 total now) covering the exact four scenarios asked for: normal handshake,
  second-unit queueing, a rules-engine miss (unrecognized phrase), and a low-confidence/garbled
  transcript — plus edge cases (ignoring pre-handshake chatter, non-active-speaker chatter not
  disrupting an exchange, follow-up-needed intents keeping the speaker active).

## 2026-08-10 — Phase 3 kickoff, ;ps protocol rewrite

- Rewrote `;ps` to the new protocol: `;ps [partial/full Roblox username] [vehicle description]`.
  Sender must hold a Sergeant+ RCMP/BCHP callsign (checked via our own callsigns table + a new
  rank-hierarchy ordering, not a raw numeric threshold — "RCMP 1200+" in the brief is shorthand
  for "Sergeant tier or above," not a literal `>=1200` check, since higher ranks have *lower*
  callsign numbers in this scheme). Partial-match against the live roster; 0 matches or 2+
  matches PMs the sender instead of guessing. Announces the *matched officer's* callsign, not
  the supervisor's. Removed the old behavior of auto-clearing the traffic-stop VC on every `;ps`
  — that's now explicitly a separate, unbuilt auto-detect feature per the updated brief.
- Started Phase 3 (Vosk STT + Piper TTS + radio protocol state machine). See below as it lands.

## 2026-08-10 — Found and fixed the real webhook delivery bug

- Root cause of *zero* events ever arriving all session: our Express app only had a `POST`
  handler for `/webhook/erlc`. ER:LC's dashboard does a `GET` health-check probe against the
  saved URL before accepting it; that 404'd ("Cannot GET /webhook/erlc") and the dashboard
  flagged the webhook as broken from the moment it was saved. Added a `GET` handler returning
  200. Confirmed fixed — real events started flowing within a minute of the fix.
- While debugging with the first real payloads, discovered the actual event shape is nothing
  like the guessed one:
  ```
  {"events":[{"event":"CustomCommand","origin":"<robloxUserId>","timestamp":N,
              "data":{"command":"verify","argument":"ABC123"}}], "server":"..."}
  ```
  vs the guessed `{"Player":"user:id","Message":";verify CODE"}`. ER:LC pre-parses `;` commands
  into `command`/`argument` itself (no raw text to split), batches multiple events per POST, and
  identifies the sender by **numeric Roblox user ID**, not username.
- Rebuilt around this: `parseEvent.ts` now parses the real batched shape. `db.ts` links/
  verify_codes tables gained a `roblox_user_id` column (nullable, additive migration — old rows
  predate this and need re-linking). `/link` now resolves the typed username to a Roblox ID via
  Roblox's public API (`users.roblox.com/v1/usernames/users`) at link time, so `;verify` matches
  by ID (immune to username changes, can't be spoofed by similar-looking names). All the drag
  commands (`;ss`/`;ts`/`;scene`/`;team`/`;ps`) and `pursuit.ts` switched from matching players
  by username to matching by the ID portion of `Player` ("Username:UserId") — more robust.
- Also discovered ER:LC sends a recurring `WebhookProbe` event type (distinct from the dashboard's
  GET probe) — `{"event":"WebhookProbe","origin":"global","data":{}}`. Handled as a no-op kind.
- Deleted 7 stale pending verify codes created before the ID column existed — they can never
  match now, user needs to run `/link` again to get a fresh one with the ID stored.

## 2026-08-09 (session 2) — Interactive /callsign manage, Components V2, duty tracking

- Split `/callsign` into `assign` (unchanged one-shot) and `manage` (new: interactive panel with
  department/rank selects + Assign/Reassign/Remove/Close buttons, gated to Directive/Executive/
  Whitelisted Command roles). Removed the old standalone `/callsign view` — folded into `manage`.
- Added `/mylink` for self-service link + callsign lookup.
- Added `/bolo` (Phase 4 item, no live-data dependency, safe to build early).
- Everything converted to Discord Components V2 (no accent color / sidebar per instruction).
- Added a callsign duty-time tracker (60s poll, credits time when a linked player's live
  in-game Callsign matches their assigned number) — only counts forward from when it shipped,
  no historical data.
- Added a callsign compliance monitor — **dry-run only, on purpose**. It depends on two things
  neither confirmed against live data nor safe to guess blind: the real `Team` field strings ER:LC
  sends per department, and the exact force-respawn staff command (the brief itself flags this
  as needing live confirmation). This is also confirmed to be the *live* "Delta Roleplay"
  production server, not a throwaway scratch one — no guessing enforcement actions against it.
- Discovered the bot's Discord role sits at position 1 (just above @everyone) while the
  Directive/Executive roles it's permission-gated on sit far above it. Discord blocks nickname
  changes (and similar actions) against higher-role members regardless of Administrator
  permission — nickname resets failed for one of two test accounts because of this. **Needs the
  bot's role moved higher in Server Settings → Roles** (see NEEDS_HUMAN_VERIFICATION.md).
- Reset all test callsign assignments and nicknames after the command restructure, per request.
- Added `nearestUnit.ts` + `callDispatch.ts` (polls emergency calls independently of the webhook,
  announces new/cleared calls with nearest on-duty unit — call `Position` field shape is
  unconfirmed since no live call has happened yet, built defensively with fallback parsing).
- Added a `node --test` suite (34 tests) covering every pure-logic module: callsign range
  assignment, compliance rules/timers, cooldowns, distance calc, event parsing, call-position
  extraction. Runs with `npm test`.
- Confirmed via a real `/v2/server?Players=true` call that this is genuinely the live
  "Delta Roleplay" server (`playdelta` join key) with 0 players online — that's *why* zero
  webhook events had arrived up to that point (before the GET-probe bug was found): nobody had
  been in-game to trigger one.

## 2026-08-09 (session 1) — Phase 0/1 scaffolding

- Express webhook receiver, Ed25519 signature verification (confirmed exact header names/
  encoding from ER:LC's real docs: `X-Signature-Ed25519` hex + `X-Signature-Timestamp`, not what
  the original brief draft implied).
- Cloudflare quick tunnel for public HTTPS (note: URL changes on every `cloudflared` restart —
  this caused real confusion this session when the saved webhook URL went stale mid-session).
- `/link`, `;verify`, SQLite schema, `/callsign` (single-command version, later split), the
  drag commands, pursuit state machine with in-game PA wiring, DM-on-verify-success, verification
  logging to the `server-management` Discord channel.
- Resolved the RCMP/BCHP callsign range overlaps into non-overlapping sub-ranges (see BRIEF.md).
