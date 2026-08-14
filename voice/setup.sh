#!/usr/bin/env bash
# Sets up the Piper (TTS) environment — broadcast-only, matches the bot's own voice/ dir.
# Models are gitignored (large binaries) — run this after cloning to fetch everything needed.
#
# 2026-08-14: STT (Vosk, listening/understanding speech) was archived per the user's explicit
# call — slow (mostly memory pressure on the dev machine), and fundamentally limited (a
# hand-coded rules engine, not real understanding). The CAD website now covers what officers
# needed voice-in for (status updates, attach-to-call, traffic-stop backup dispatch). See
# ~/Desktop/delta-city-dispatch-voice-understanding-archive/ if this ever needs reviving — that
# folder has the original setup.sh with the Vosk download step, plus radioSession.ts/
# radioIntents.ts and their tests, sttServer.ts, and the stt_*.py scripts.
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q

mkdir -p models/piper-voices

# Ryan — male voice (Piper's lessac voice is female; confirmed via multiple independent voice
# catalogs plus a local pitch check: ryan ~168Hz vs lessac ~179Hz).
if [ ! -f models/piper-voices/en_US-ryan-medium.onnx ]; then
  echo "Downloading Piper en_US-ryan-medium voice (male)..."
  curl -sL -o models/piper-voices/en_US-ryan-medium.onnx \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx"
  curl -sL -o models/piper-voices/en_US-ryan-medium.onnx.json \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json"
fi

echo "Done. Test with:"
echo "  source .venv/bin/activate"
echo "  python3 tts_speak.py 'one four zero nine, go ahead.' test-audio/out.wav"
