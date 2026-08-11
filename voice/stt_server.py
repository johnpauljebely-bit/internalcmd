#!/usr/bin/env python3
"""Persistent STT server: loads the Vosk model ONCE, then transcribes WAV paths read line-by-line
from stdin, writing {"text": ..., "confidence": ...} JSON per line to stdout.

Exists because bigger/more-accurate Vosk models take real time to load (the lgraph model takes
well over a minute on this machine) — spawning a fresh process per utterance (the original
design) would make every single utterance wait through a full model load, which is unusable for
live voice dispatch. This process stays alive for the life of the bot and services requests
without reloading.

Protocol: prints {"ready": true} once the model is loaded, then one JSON result per input line.
"""
import json
import sys
import wave
from pathlib import Path
from vosk import Model, KaldiRecognizer

MODEL_PATH = Path(__file__).parent / "models" / "vosk-model-en-us-0.22-lgraph"


def transcribe(wav_path: str, model: Model) -> dict:
    wf = wave.open(wav_path, "rb")
    if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
        raise ValueError("Expected mono 16-bit PCM WAV")

    rec = KaldiRecognizer(model, wf.getframerate())
    rec.SetWords(True)

    text_pieces = []
    word_confidences = []

    def collect(result: dict):
        if result.get("text"):
            text_pieces.append(result["text"])
        for word in result.get("result", []):
            if "conf" in word:
                word_confidences.append(word["conf"])

    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break
        if rec.AcceptWaveform(data):
            collect(json.loads(rec.Result()))

    collect(json.loads(rec.FinalResult()))

    confidence = sum(word_confidences) / len(word_confidences) if word_confidences else None
    return {"text": " ".join(text_pieces).strip(), "confidence": confidence}


def main():
    model = Model(str(MODEL_PATH))
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        wav_path = line.strip()
        if not wav_path:
            continue
        try:
            result = transcribe(wav_path, model)
        except Exception as e:  # noqa: BLE001 - report any failure back over the same protocol
            result = {"error": str(e)}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
