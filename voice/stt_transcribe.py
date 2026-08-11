#!/usr/bin/env python3
"""WAV file in, transcript + confidence out as JSON. Proves Vosk works standalone before wiring
anything to it.

Usage: python3 stt_transcribe.py path/to/audio.wav
Expects 16kHz mono 16-bit PCM WAV (matches what Discord audio will be resampled to).
Prints {"text": "...", "confidence": 0.0-1.0 or null} to stdout.
"""
import json
import sys
import wave
from pathlib import Path
from vosk import Model, KaldiRecognizer

MODEL_PATH = Path(__file__).parent / "models" / "vosk-model-en-us-0.22-lgraph"


def transcribe(wav_path: str) -> dict:
    wf = wave.open(wav_path, "rb")
    if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
        raise ValueError("Expected mono 16-bit PCM WAV")

    model = Model(str(MODEL_PATH))
    rec = KaldiRecognizer(model, wf.getframerate())
    rec.SetWords(True)  # per-word confidence scores in the result

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


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: stt_transcribe.py <wav_path>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(transcribe(sys.argv[1])))
