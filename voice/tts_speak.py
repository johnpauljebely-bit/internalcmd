#!/usr/bin/env python3
"""Text in, spoken WAV out. Proves Piper works standalone before wiring anything to it.

Usage: python3 tts_speak.py "text to speak" output.wav
"""
import subprocess
import sys
from pathlib import Path

# Ryan — documented male voice (fine-tuned from lessac, which is female), confirmed lower
# average pitch in a local test (~168Hz vs lessac's ~179Hz).
MODEL_PATH = Path(__file__).parent / "models" / "piper-voices" / "en_US-ryan-medium.onnx"
# "piper" is a console-script installed alongside this Python interpreter in the venv — resolve
# it relative to sys.executable rather than relying on PATH, since callers (e.g. the Node bridge)
# spawn this venv's python3 directly without activating the venv first.
PIPER_BIN = Path(sys.executable).parent / "piper"


def speak(text: str, output_path: str) -> None:
    subprocess.run(
        [str(PIPER_BIN), "-m", str(MODEL_PATH), "-f", output_path],
        input=text,
        text=True,
        check=True,
        capture_output=True,
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: tts_speak.py <text> <output_wav_path>", file=sys.stderr)
        sys.exit(1)
    speak(sys.argv[1], sys.argv[2])
    print(f"wrote {sys.argv[2]}")
