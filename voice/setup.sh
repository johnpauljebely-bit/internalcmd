#!/usr/bin/env bash
# Sets up the Vosk (STT) + Piper (TTS) environment. Models are gitignored (large binaries) —
# run this after cloning to fetch everything needed.
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q

mkdir -p models/piper-voices

# The small model (~40MB) badly mangles real speech — confirmed live, it turned "1409 to
# dispatch" into things like "vance to dispatch". This lgraph model (~124MB) is meaningfully more
# accurate but takes 20s+ to load, which is why the live pipeline (src/voice/sttServer.ts) keeps
# it loaded in a persistent process rather than loading it per utterance.
if [ ! -d models/vosk-model-en-us-0.22-lgraph ]; then
  echo "Downloading Vosk en-us-0.22-lgraph model (~124MB)..."
  curl -sL -o /tmp/vosk-model.zip https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip
  unzip -q /tmp/vosk-model.zip -d models
  rm /tmp/vosk-model.zip
fi

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
echo "  python3 stt_transcribe.py test-audio/sample.wav"
echo "  python3 tts_speak.py 'one four zero nine, go ahead.' test-audio/out.wav"
