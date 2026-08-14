import { createAudioResource, type AudioPlayer } from "@discordjs/voice";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { VoiceBasedChannel } from "discord.js";
import { synthesizeSpeechPersistent } from "./ttsServer.js";
import { containerMessage } from "../ui.js";

// Separated from voiceSession.ts to avoid a circular import: pursuit.ts needs
// speakToActiveDispatcher (BOLO/pursuit announcements must also be spoken, not just
// text/PA'd), and voiceSession.ts already imports isPursuitActive from pursuit.ts.
let activePlayer: AudioPlayer | null = null;
let activeChannel: VoiceBasedChannel | null = null;

export function setActivePlayer(player: AudioPlayer | null): void {
  activePlayer = player;
}

// Set alongside activePlayer by voiceSession.ts's startVoiceDispatcher/stop — kept as a pair, one
// is never set without the other. Lets dispatch-INITIATED announcements (calls, panics, BOLOs,
// pursuits, CAD-triggered messages) post the same style of summary embed already used for
// officer-initiated transmissions (see postSummary in voiceSession.ts), which previously only
// went to RTO_CHANNEL_ID/PA/voice — never the voice channel's own text-in-voice chat. Confirmed
// real gap (2026-08-14): officer→dispatch was logged there, dispatch→everyone wasn't.
export function setActiveChannel(channel: VoiceBasedChannel | null): void {
  activeChannel = channel;
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

async function postDispatchSummary(text: string): Promise<void> {
  if (!activeChannel || !activeChannel.isSendable()) return;
  try {
    await activeChannel.send(containerMessage(`Dispatch: ${text}`));
  } catch (err) {
    console.error("[voice] failed to post dispatch summary to channel", err);
  }
}

// The actual thing every dispatch-INITIATED announcement (calls, panics, BOLOs, pursuits,
// CAD-triggered messages) should call instead of speakToActiveDispatcher alone — speaks AND posts
// the matching text-chat embed together, so no call site can forget one or the other. Officer→
// dispatch transmissions already get their own summary via postSummary in voiceSession.ts; this
// is specifically for the other direction.
export async function announceToActiveDispatcher(text: string): Promise<boolean> {
  if (!activePlayer) return false;
  await Promise.all([speakOn(activePlayer, text), postDispatchSummary(text)]);
  return true;
}
