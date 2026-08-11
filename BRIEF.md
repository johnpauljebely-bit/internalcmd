# Delta City Roleplay — Dispatch System Project Brief

## What this is
A custom Discord bot + web service for an ER:LC (Emergency Response: Liberty
County) private server, handling AI dispatch, voice, and all custom `;` in-game
commands. Owns the ER:LC Event Webhook exclusively — no other app shares that slot.
Melonly stays in the stack for the LEO CAD dashboard/roster/records UI (not
rebuilding that), connected via its own API key so it can poll ER:LC data
independently of our webhook.

## Melonly coexistence
- Melonly gets our ER:LC server API key entered into its own dashboard, so it can
  poll `/v2/server` for live roster/position data and power the CAD dashboard,
  records, and manual call creation. This should not require the ER:LC webhook.
- Our bot owns the ER:LC Event Webhook slot exclusively — required since it's a
  single URL field and our custom commands need real-time delivery.
- Trade-off: Melonly's own chat-command shortcuts (`;status`, `;panic`, `;sn`
  name search, `;sp` plate search, `;ts <plate>` quick traffic-stop record)
  specifically require ER:LC's webhook pointed at `melon.ly/events` to fire, so
  those won't trigger while we hold the webhook. Acceptable — only `;ts` actually
  overlaps our own naming (ours drags to a VC, Melonly's logs a traffic stop).
  Our "panic" trigger is the native in-game panic-button event, not a typed
  `;panic` command, so it isn't really the same trigger as Melonly's shortcut.
- **Phase 0 checkpoint:** confirm Melonly's dashboard still shows live data with
  just the API key connected and the webhook pointed elsewhere. If some Melonly
  feature turns out to hard-require the webhook, fallback is having our receiver
  forward the identical signed payload on to `melon.ly/events` after processing it.

## Stack
- Node.js + TypeScript
- discord.js v14 (+ @discordjs/voice for VC moves and, later, audio)
- Express for the webhook receiver
- SQLite for the account-link table, plus whatever local state the voice dispatcher needs (Melonly is the system of record for roster/call log, not us)
- Hosting: Oracle Cloud's Always Free tier — an Ampere A1 (ARM) VM. Genuinely free
  forever (not a 12-month trial), and unlike lightweight bot-hosting free tiers
  (Wispbyte/Hostship), it's a real VM with real compute — enough to run the
  webhook receiver, text commands, AND the voice dispatcher's STT/TTS all on the
  same always-on box, no need for a PC to be online. Was cut from 4 OCPU/24GB to
  2 OCPU/12GB in June 2026 but that's still plenty for Vosk + Piper. Signup wants
  a card for verification (not charged); if ARM provisioning says "out of
  capacity," try the Frankfurt or Singapore region instead of a busy US one.
- Public HTTPS: Cloudflare Tunnel (cloudflared) + a cheap owned domain, pointed at
  the bot's local port — same setup already proven working in testing. With a
  real VM you could alternatively point a domain straight at its public IP and
  get a cert with Let's Encrypt/certbot directly, but Cloudflare Tunnel avoids
  manual cert renewal and opening firewall ports, so stick with what's tested.

## ER:LC API facts (confirmed from apidocs.erlc.gg, current as of this doc)
- Base: `https://api.erlc.gg/v2` (legacy `api.policeroleplay.community` still works)
- Auth header: `server-key: YOUR_KEY`
- `GET /v2/server?Players=true&Vehicles=true&EmergencyCalls=true` — live players
  (Location.LocationX/Z, PostalCode, StreetName, Callsign, Team, WantedStars) and
  live emergency calls (Team, Caller, Position, StartedAt, CallNumber, Description).
- `POST /v2/server/command` with `{"command": ":h message"}` — send in-game PA
  announcements/commands as "virtual server management".
- Event Webhook — real-time signed POSTs to our own HTTPS endpoint.
  Ed25519-verify every request: message = timestamp string + raw body bytes,
  public key: `MCowBQYDK2VwAyEAjSICb9pp0kHizGQtdG8ySWsDChfGqi+gyFCttigBNOA=`.
  **Chat messages prefixed with `;` are ER:LC's documented convention for custom
  bot commands** — this is how we catch `;ss`, `;ts`, etc. Exact field names for
  less-common events (panic button in particular) aren't fully documented — log
  raw payloads in Phase 0 to confirm them against real gameplay.
- **CONFIRMED LIVE (2026-08-10):** real payload shape is
  `{"events":[{"event":"CustomCommand"|"WebhookProbe","origin":"<robloxUserId>","timestamp":N,"data":{"command":"verify","argument":"ABC123"}}],"server":"..."}`.
  Batched array, not a single event. Sender identified by **numeric Roblox user
  ID**, not username. ER:LC also does a periodic `GET` probe against the saved
  webhook URL to validate it — our server must return 2xx on GET too, or the
  dashboard flags the webhook as broken (this bit us for the entire first
  session — see CHANGELOG.md).

## Roblox ↔ Discord linking (custom, no Bloxlink)
1. Discord: `/link <roblox-username>` → bot resolves the username to a Roblox
   user ID via Roblox's public API, generates a short one-time code.
2. In-game: player types `;verify <code>`.
3. Webhook receives it, checks the code, confirms the sender's Roblox **user ID**
   matches (not username — the webhook only gives us the ID), stores the
   Discord ID ↔ Roblox ID ↔ Roblox username mapping.
Proximity-based commands (`;ts`, `;scene`) and callsign lookups depend on this
table existing before they can work.

## Departments & callsigns

**Delta Police** — unwhitelisted (anyone can play). Callsigns must be 400–499,
self-chosen (not auto-assigned), just needs to be unique and in range.
- Soft enforcement: wrong/missing callsign → PM in-game every 2 minutes telling
  them to change it.
- Hard enforcement: after 6 minutes of no compliance, escalate — force a `:load`
  (confirm exact ER:LC staff command during Phase 1 testing) on the player, PM
  them 3 seconds after the load, and repeat the load+PM cycle every 2 minutes
  until they comply.
- Once on a valid callsign: Discord nickname becomes `[callsign] | [username]` —
  same format for every department.

**RCMP** (whitelisted)

| Rank | Callsign range |
|---|---|
| Constable | 1400–1499 |
| Corporal | 1300–1399 |
| Sergeant | 1200–1299 |
| Inspector | 1100–1199 |
| Superintendent | 1000–1099 |
| Commissioner | 1000–1099 |

**BCHP** (whitelisted)

| Rank | Callsign range |
|---|---|
| Constable | 2400–2499 |
| Corporal | 2300–2399 |
| Sergeant | 2200–2299 |
| Staff Sergeant | 2100–2199 |
| Inspector | 2100–2149 |
| Superintendent | 2000–2099 |
| Chief Superintendent | 2000–2099 |

**RESOLVED (2026-08-09):** RCMP Superintendent 1000–1049 / Commissioner
1050–1099. BCHP Superintendent 2000–2049 / Chief Superintendent 2050–2099 /
Inspector 2100–2149 / Staff Sergeant 2150–2199. All ranges now non-overlapping.

**Delta Fire** — not set up yet, placeholder for later.

**Whitelisted departments (RCMP/BCHP) enforcement** — no grace period like Delta
PD gets. Wrong callsign detected → immediate `:load`, PM'd 3 seconds after the
load, telling them to use their assigned callsign.

**`/callsign [user] [department] [rank]`** — Discord slash command, restricted to
members holding the top 2 ranks of that department. Auto-assigns the target user
the lowest available unused number in that rank's range.
- Permission check needs to be role-based in Discord, not pulled live from
  ER:LC — the ER:LC API only exposes a broad `Team` field (e.g. "RCMP"), not
  fine-grained in-game rank, so "top 2 ranks" and department rank generally have
  to be tracked via Discord roles (or our own DB), same as callsign assignments.
- **RESOLVED (2026-08-09):** no RCMP/BCHP rank roles exist in Discord yet, so
  this permission check uses Directive/Executive-tier/Whitelisted Command roles
  as a stand-in until real department rank roles exist. Built as `/callsign
  assign` and `/callsign manage` (view/reassign/remove, interactive).

**Callsigns in dispatch** — these are the real identifiers the radio protocol
above uses. The `1409`/`1378` examples earlier were illustrative; real traffic
uses whatever callsign the unit is actually assigned (e.g. an RCMP Sergeant on
1247, a Delta PD officer on 442).

## In-game chat commands (all via the `;` webhook convention)
| Command | Behavior |
|---|---|
| `;ss` | Drag the sender into the staff scene VC |
| `;ts` | Drag everyone within proximity into the traffic stop VC |
| `;scene` | Drag everyone within proximity into the scene VC |
| `;team` | Drag the sender to their current team's VC |
| `;ps [partial or full Roblox username] [vehicle description]` | Declares a pursuit. Gated: only a Sergeant+ (RCMP 1200+, BCHP 2200+) who is on duty can run this — their choice to type it *is* the approval, there's no separate accept step unless wanted. Resolve the username against the live player list (`/v2/server` Players) — partial match, handle ambiguity if more than one player matches. Look up that matched player's own callsign/department to announce as the pursuing unit (not the supervisor's callsign): "all units hold traffic, active pursuit, officer [pursuing officer's callsign] pursuing [vehicle description], current postal is [postal], all available units respond." Update postal every 7s using the pursuing officer's live position. The bot stops listening/responding to voice in the RTO channel for the duration — no channel permission changes, people can still talk to each other, the bot just ignores them. |
| `ps end` | "Pursuit is over, all units return 10-8, suspect down." Bot resumes listening/responding to voice in RTO. |
| traffic-stop fleeing (auto) | Separate from `;ps` — when a stopped vehicle flees during a `;ts` traffic stop, auto-drag whoever's in the traffic stop VC back to the RTO VC. **OPEN QUESTION, UNBUILT:** no confirmed way yet to detect "the vehicle fled" from the ER:LC API/webhook — no obvious event for it. Possibly a speed/distance spike heuristic. Not built until a real trigger is found. |
| panic event | Announce in RTO: "all units be advised, officer [callsign] is down, officers need help." **UNCONFIRMED whether ER:LC's webhook even sends a panic event at all** — docs only document `CustomCommand` and (implicitly) call events; no panic event has ever been observed live. |

Radio codes/phonetics: Delta PD (BC) + RCMP 10-codes throughout.

## Voice dispatcher radio protocol
Half-duplex, one transmission understood at a time — mirrors real radio discipline,
not a free-for-all group chat with the bot.

1. **Call-in.** Unit keys up with callsign first: "1409 to dispatch." Dispatch
   doesn't process anything else said before this handshake.
2. **Go-ahead.** Dispatch responds "1409, go ahead" and now treats 1409 as the
   active speaker — it's actively trying to understand only them until they're done.
3. **Message.** 1409 transmits their actual message.
4. **Acknowledge or clarify.** If dispatch understood it: "10-4, I understand,"
   then it acts on the request or asks a natural follow-up question if it needs
   more info. If it didn't understand: it asks 1409 to repeat, rather than
   guessing or silently failing.
5. **Queueing.** If another unit (e.g. 1378) keys up while dispatch is still
   mid-exchange with 1409, dispatch replies "1378, please hold" and queues them
   (FIFO). Once the 1409 exchange resolves, dispatch comes back to the queue:
   "1378, go ahead" — then step 3 onward repeats for them.

Implementation-wise this needs a simple state machine per dispatch session: an
`activeSpeaker` slot and a FIFO hold queue, gating what the STT→response pipeline
actually acts on versus what gets queued or asked to repeat.

## Feature list (from original request)
- Live 911-style call read-out via TTS into a dispatch VC
- Two-way voice: members talk to the bot, get responses (STT → response logic → TTS)
- Nearest-unit dispatch from live positions
- Automatic officer-down & pursuit alerts
- BOLO broadcasts & call-cleared updates
- Traffic-stop auto-return on pursuit (separate from `;ps` — see the open question in the commands table, detection trigger still unresolved)
- Live roster & unit-status board (Melonly's dashboard, not built by us)
- Region-accurate radio codes & phonetics

## Operational guardrails
- **Permissions.** Only linked, on-duty LEO members (or a specific Discord role)
  can trigger `;ss`/`;ts`/`;scene`/`;team`/`;ps` — if a civilian or unlinked
  player types one, the bot silently ignores it rather than erroring or replying,
  so it doesn't invite griefing.
- **Cooldowns.** Per-user cooldown (5–10s) on the drag commands so an accidental
  double-send or spam doesn't flood VC moves or the ER:LC command API.
- **Rate limits.** Respect ER:LC's `X-RateLimit-*` response headers on every API
  call; back off automatically on a 429 instead of hammering it.
- **API resilience.** The ER:LC API has occasional outages, notably after weekend
  game updates. Wrap all calls in retry/backoff, and have the bot announce
  "dispatch data temporarily unavailable" in-channel rather than crashing or
  silently failing.
- **Roblox chat filter.** Every in-game message sent via "virtual server
  management" (ER:LC's name for the account bot-run commands appear under — what
  you called remote server management) passes through Roblox's chat filter
  before players see it. Keep message templates simple and test each one
  in-game early, since filtering can silently alter or block certain phrasing —
  applies to pursuit announcements, panic alerts, and the callsign nag PMs alike.
- **Test on a scratch server first.** Spin up a second, throwaway ER:LC private
  server for developing/testing pursuit, panic, and voice logic — don't debug
  against the live Delta City Roleplay server while members are playing on it.
  **NOTE: confirmed this hasn't happened yet — the only server is the live
  "Delta Roleplay" production one (playdelta join key, OwnerId 7822749012).**

## Voice pipeline notes
Free is the hard requirement, so this stays self-hosted/open-source instead of
usage-billed APIs — no Deepgram/ElevenLabs/LLM-per-utterance bill.

- **STT — Vosk.** Free, offline, runs on CPU, no account or key. Lower raw
  accuracy than paid cloud STT, but that's an acceptable trade here because
  radio traffic is structured (callsigns, 10-codes, plate formats) — good fit
  for pattern-matching rather than free-form dictation. whisper.cpp is the
  fallback if Vosk's accuracy turns out too rough in practice — better accuracy,
  meaningfully heavier on CPU.
- **TTS — Piper.** Free, open-source, built specifically for fast local voice
  assistants (came out of the Home Assistant project) — good quality-to-compute
  ratio, no per-character billing. eSpeak-ng is the even-lighter fallback if
  Piper is still too heavy on your hardware, at the cost of sounding more robotic.
- **Brain — rules engine only, no LLM.** Every recognized phrase (status update,
  10-code request, plate/BOLO check) gets matched to a canned response template.
  Anything unrecognized triggers "say again" rather than an LLM call. This keeps
  the whole pipeline genuinely $0 — if you ever want smarter open-ended replies
  later, free-tier LLM APIs exist (Groq's free tier is generous) as an optional
  add-on, not a requirement.
- **Compute reality check.** This is exactly why we moved off Wispbyte-style
  hosting for this project (see Stack, above) — free *money-wise* isn't the same
  as free *compute-wise*, and lightweight bot-hosting tiers aren't sized for
  real-time audio ML. The Oracle Cloud Always Free VM's 2 OCPU/12GB is enough
  for Vosk + Piper to run comfortably alongside the webhook receiver and text
  commands, all on the same always-on box — no PC needs to be on.
- **Secrets.** Bot token, ER:LC server key, and Melonly API key live in `.env`,
  never committed. No STT/TTS keys needed with this stack. Keep a `.env.example`
  with blank values checked into git as the reference.

## Build order
- **Phase 0 — Plumbing.** DONE. Express webhook receiver, Ed25519 verification,
  Cloudflare Tunnel, real event shape confirmed live.
- **Phase 1 — Text commands.** DONE except panic (unconfirmed event) and
  traffic-stop-fleeing auto-detect (no trigger exists yet). `;verify`, `;ss`,
  `;ts`, `;scene`, `;team`, `;ps` (new protocol), `ps end` all built against the
  real confirmed payload shape. `/callsign assign|manage`, `/mylink`, `/bolo`
  all built.
- **Phase 2 — Dispatch data.** Mostly done: roster/call polling, nearest-unit
  logic, callsign compliance monitor (dry-run gated pending live Team-name and
  force-respawn-command confirmation).
- **Phase 3 — Voice dispatcher.** IN PROGRESS. VC audio capture → Vosk (STT) →
  rules-engine response → Piper (TTS), following the radio protocol spec above
  (callsign handshake, one active speaker, hold queue). Runs on the same Oracle
  VM as everything else, genuinely 24/7. Hardest part to build; building now.
- **Phase 4 — Extras.** `/bolo` done. Call-cleared updates done (call-dispatch
  polling announces both new and cleared calls). Traffic-stop auto-return still
  blocked on a detection trigger.

## Working agreement with Claude Code
- Use the VS Code extension, auto-accept mode for scaffolding.
- Self-test everything mockable (curl the webhook with fake signed payloads, run
  unit tests, start/stop the server) before asking for manual verification.
- It cannot join Discord voice or open Roblox — when a step needs that, it should
  say exactly what to do and what result to expect, not just "please test."
- **2026-08-10:** working autonomously on Phase 3 without stopping to ask —
  self-correct in a loop (write, test, fix, repeat). Track blockers in
  `NEEDS_HUMAN_VERIFICATION.md` instead of stopping. Track progress/decisions in
  `CHANGELOG.md`. Cannot provision Oracle Cloud (needs a human with payment
  info) — stays a `NEEDS_HUMAN_VERIFICATION.md` item, keep developing locally.
