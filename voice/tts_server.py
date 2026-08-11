#!/usr/bin/env python3
"""Persistent TTS server: loads the Piper voice ONCE, then synthesizes text read line-by-line
(as JSON: {"text": ..., "output": "/path/to.wav"}) from stdin, writing {"ok": true} or
{"error": ...} per line to stdout.

Exists for the same reason as stt_server.py — tts_speak.py (still the standalone test script)
spawns the "piper" CLI fresh per call, which reloads the model every single response. Live
dispatch needs to be fast, not just accurate, so this keeps the voice loaded in a persistent
process instead.
"""
import json
import sys
import wave
from pathlib import Path
from piper import PiperVoice

MODEL_PATH = Path(__file__).parent / "models" / "piper-voices" / "en_US-ryan-medium.onnx"


def main():
    voice = PiperVoice.load(str(MODEL_PATH))
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            with wave.open(req["output"], "wb") as wav_file:
                voice.synthesize_wav(req["text"], wav_file)
            print(json.dumps({"ok": True}), flush=True)
        except Exception as e:  # noqa: BLE001 - report any failure back over the same protocol
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
