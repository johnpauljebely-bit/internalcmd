# Delta City Dispatch

Discord bot + webhook service for the Delta City Roleplay ER:LC server — in-game text commands,
callsign management, broadcast-only voice announcements (TTS), compliance monitoring, and a
mod-call flow, backed by a Postgres database shared with the companion `delta-city-cad` website.
See **[BRIEF.md](BRIEF.md)** for the full
project spec, **[CHANGELOG.md](CHANGELOG.md)** for what's been built and why, and
**[NEEDS_HUMAN_VERIFICATION.md](NEEDS_HUMAN_VERIFICATION.md)** for what's blocked on live
testing or account access only a human can provide.

## Quick start

```bash
npm install
cp .env.example .env   # fill in real values — see below
npm test                # 57 tests, pure logic, no server/network needed
npm run typecheck
npm run dev              # starts the server (webhook receiver + Discord bot)
```

Health check: `curl localhost:3000/health`. Webhook endpoint is `POST /webhook/erlc` (GET also
answers 200 — required for ER:LC's dashboard validation probe, see CHANGELOG for why).

For public HTTPS during local dev: `cloudflared tunnel --url http://localhost:3000`, then paste
the printed URL + `/webhook/erlc` into ER:LC's server settings as the Event Webhook. **The URL
changes every time `cloudflared` restarts** — re-save it in ER:LC's dashboard whenever that
happens, or events silently stop arriving.

## Voice dispatcher (broadcast-only)

Dispatch can join a voice channel and speak announcements (calls, panics, BOLOs, pursuits,
CAD-triggered messages via `/internal/announce`) into it — it does not listen or try to understand
speech. The listen/understand side (STT, a rules-engine intent matcher) was archived 2026-08-14;
see `~/Desktop/delta-city-dispatch-voice-understanding-archive/README.md` if it's ever needed
again. The CAD website now covers what officers used voice-in for (status updates, attach-to-call,
traffic-stop backup dispatch).

Needs Python 3 + a one-time Piper voice download (~60MB, gitignored):

```bash
cd voice
./setup.sh
source .venv/bin/activate
python3 tts_speak.py "one four zero nine, go ahead." test-audio/out.wav
```

Voice is `en_US-ryan-medium` (male). In Discord: run `/dispatch enable` and pick a voice channel
(Director/Executive/Manager role required).

**Say callsigns digit-by-digit** ("one four zero nine"), not as a whole number — confirmed this
is what Piper handles reliably; whole numbers get badly mangled ("nine hundred eleven" instead of
"nine one one" for emergency codes was a real bug, now fixed for numbers embedded in free text
too — see `formatEmergencyCodesForSpeech` in `speechFormat.ts`).

Every dispatch-initiated announcement also posts a matching text-chat embed ("Dispatch: ...") in
the voice channel's own text-in-voice chat, in addition to speaking it — added 2026-08-14 so
there's a visible log, not just audio that's gone once said.

## Project structure

- `src/index.ts` — Express app entry point, webhook route, boots the Discord bot + background pollers
- `src/discordBot.ts`, `src/commands/` — Discord client, slash commands (`/link`, `/callsign`, `/mylink`, `/bolo`, `/dispatch`)
- `src/chatCommands.ts`, `src/parseEvent.ts` — in-game `;`-command parsing and routing
- `src/db.ts` — Postgres schema (links, verify codes, callsigns, calls, live units/players) — shared with the `delta-city-cad` website, same database
- `src/internalApi.ts` — authenticated `POST /internal/announce`, the CAD website's only way to trigger an in-game PA (no ER:LC server key of its own)
- `src/erlcClient.ts`, `src/robloxClient.ts` — external API clients (ER:LC, Roblox)
- `src/pursuit.ts`, `src/complianceMonitor.ts`, `src/complianceRules.ts`, `src/nearestUnit.ts`, `src/callDispatch.ts` — dispatch-data-driven features
- `src/joinReminder.ts`, `src/roleplayHints.ts`, `src/modCallDetector.ts` — background pollers: non-linked-player reminders, roleplay-quality PA hints, mod-call auto-resolution (watches the ER:LC command log for a staff teleport)
- `src/speechFormat.ts` — speech-formatting helpers (digit-by-digit numbers, NATO phonetic plates, N-1-1 emergency codes), pure and tested
- `src/voice/` — Discord audio glue, broadcast-only: `voiceSession.ts` (join + speak), `ttsServer.ts` (persistent TTS process), `activeDispatcherRegistry.ts` (lets other modules speak into an active session + post the matching text-chat embed, without a circular import)
- `voice/` (top-level) — Python venv, Piper voice model, and TTS test scripts (gitignored except the scripts themselves)
- `*.test.ts` files are colocated with what they test, run via `npm test`

## Known guesses that need live confirmation

Anything with an "UNCONFIRMED" comment in the code — see NEEDS_HUMAN_VERIFICATION.md for the
full list and why. The short version: several ER:LC field names/values and command syntaxes were
never documented publicly and could only be confirmed by watching real gameplay traffic, which
hasn't happened much yet.
