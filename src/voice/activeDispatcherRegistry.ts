import { createAudioResource, type AudioPlayer } from "@discordjs/voice";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { synthesizeSpeechPersistent } from "./ttsServer.js";

// Separated from voiceSession.ts to avoid a circular import: pursuit.ts needs
// speakToActiveDispatcher (BOLO/pursuit announcements must also be spoken, not just
// text/PA'd), and voiceSession.ts already imports isPursuitActive from pursuit.ts.
let activePlayer: AudioPlayer | null = null;

export function setActivePlayer(player: AudioPlayer | null): void {
  activePlayer = player;
}

export function isDispatcherActive(): boolean {
  return activePlayer !== null;
}

export async function speakOn(player: AudioPlayer, text: string): Promise<void> {
  const outPath = path.join(os.tmpdir(), `dcd-tts-${randomUUID()}.wav`);
  try {
    console.log(`[voice] speaking: "${text}"`);
    await synthesizeSpeechPersistent(text, outPath);
    player.play(createAudioResource(outPath));
  } finally {
    // Playback reads the file asynchronously — give it a head start before cleanup.
    setTimeout(() => unlink(outPath).catch(() => {}), 30_000);
  }
}

export async function speakToActiveDispatcher(text: string): Promise<boolean> {
  if (!activePlayer) return false;
  await speakOn(activePlayer, text);
  return true;
}
