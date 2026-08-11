# Delta City Dispatch

Discord bot + webhook service for the Delta City Roleplay ER:LC server — text commands, callsign
management, and (in progress) a voice dispatcher. See **[BRIEF.md](BRIEF.md)** for the full
project spec, **[CHANGELOG.md](CHANGELOG.md)** for what's been built and why, and
**[NEEDS_HUMAN_VERIFICATION.md](NEEDS_HUMAN_VERIFICATION.md)** for what's blocked on live
testing or account access only a human can provide.

## Quick start

```bash
npm install
cp .env.example .env   # fill in real values — see below
npm test                # 62 tests, pure logic, no server/network needed
npm run typecheck
npm run dev              # starts the server (webhook receiver + Discord bot)
```

Health check: `curl localhost:3000/health`. Webhook endpoint is `POST /webhook/erlc` (GET also
answers 200 — required for ER:LC's dashboard validation probe, see CHANGELOG for why).

For public HTTPS during local dev: `cloudflared tunnel --url http://localhost:3000`, then paste
the printed URL + `/webhook/erlc` into ER:LC's server settings as the Event Webhook. **The URL
changes every time `cloudflared` restarts** — re-save it in ER:LC's dashboard whenever that
happens, or events silently stop arriving.

## Voice dispatcher (Phase 3)

Needs Python 3 + a one-time model download (~190MB, gitignored — a more accurate Vosk model than
Vosk's "small" default, since the small one badly mangles real speech, confirmed live):

```bash
cd voice
./setup.sh
source .venv/bin/activate
python3 stt_transcribe.py test-audio/sample2.wav   # should print a transcript + confidence
python3 tts_speak.py "one four zero nine, go ahead." test-audio/out.wav
```

Voice is `en_US-ryan-medium` (male). In Discord: run `/dispatch enable` and pick a voice channel
(Director/Executive/Manager role required). See NEEDS_HUMAN_VERIFICATION.md for the exact test
script (what to say, what to expect back) and current status — playback mechanics are confirmed
working via a real self-test; STT-on-real-speech has been tested live once, found broken, and
fixed since, but not yet re-verified live.

**Say callsigns digit-by-digit** ("one four zero nine"), not as a whole number — confirmed this
is what both Vosk (STT) and Piper (TTS) handle reliably; whole numbers get badly mangled.

Every voice pipeline transmission posts a text summary (what was heard + what action was taken)
in the voice channel's own text-in-voice chat, in addition to speaking the response — this is a
standing requirement (see memory), not just a debug aid, and should never regress back to
speak-only.

## Project structure

- `src/index.ts` — Express app entry point, webhook route, boots the Discord bot + background pollers
- `src/discordBot.ts`, `src/commands/` — Discord client, slash commands (`/link`, `/callsign`, `/mylink`, `/bolo`, `/dispatch`)
- `src/chatCommands.ts`, `src/parseEvent.ts` — in-game `;`-command parsing and routing
- `src/db.ts` — SQLite schema (links, verify codes, callsigns)
- `src/erlcClient.ts`, `src/robloxClient.ts` — external API clients (ER:LC, Roblox)
- `src/pursuit.ts`, `src/complianceMonitor.ts`, `src/complianceRules.ts`, `src/nearestUnit.ts`, `src/callDispatch.ts` — dispatch-data-driven features
- `src/radioSession.ts`, `src/radioIntents.ts`, `src/speechFormat.ts` — voice protocol logic (pure, tested)
- `src/voice/` — Discord audio glue: `voiceSession.ts` (join/capture/play, speak side self-tested working), `sttServer.ts` (persistent STT process), `pythonBridge.ts` (TTS)
- `voice/` (top-level) — Python venv, models, and standalone STT/TTS test scripts (gitignored except the scripts themselves)
- `*.test.ts` files are colocated with what they test, run via `npm test`

## Known guesses that need live confirmation

Anything with an "UNCONFIRMED" comment in the code — see NEEDS_HUMAN_VERIFICATION.md for the
full list and why. The short version: several ER:LC field names/values and command syntaxes were
never documented publicly and could only be confirmed by watching real gameplay traffic, which
hasn't happened much yet.
