import {
  joinVoiceChannel,
  createAudioPlayer,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  type VoiceConnection,
  type AudioPlayer,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import { setActivePlayer, setActiveChannel } from "./activeDispatcherRegistry.js";

export interface VoiceDispatcherHandle {
  connection: VoiceConnection;
  player: AudioPlayer;
  stop: () => void;
}

// Broadcast-only — joins a voice channel and makes it possible to speak announcements (calls,
// panics, BOLOs, pursuits, CAD-triggered messages) into it via announceToActiveDispatcher(). Does
// NOT listen or try to understand speech.
//
// 2026-08-14: the listening/understanding half (STT, the radioSession/radioIntents rules engine,
// the officer-speaks-dispatch-responds protocol) was archived per the user's explicit call — it
// was slow (mostly a memory-pressure problem on the dev machine, not a code issue) and
// fundamentally limited (a hand-coded rules engine, not real understanding — "knows nothing, like
// a toddler driving a car"). The CAD website now covers what officers actually needed it for
// (status updates, attach-to-call, traffic-stop backup dispatch with real nearest-unit logic —
// confirmed via a parity check with the CAD session before cutting anything, see
// COORDINATION.md). Archived, not deleted — the original code, its tests, and the STT server live
// at ~/Desktop/delta-city-dispatch-voice-understanding-archive/ if this ever needs reviving.
export async function startVoiceDispatcher(channel: VoiceBasedChannel): Promise<VoiceDispatcherHandle> {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  connection.on("error", (err) => console.error("[voice] connection error", err));

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  player.on("error", (err) => console.error("[voice] audio player error", err));
  player.on(AudioPlayerStatus.Playing, () => console.log("[voice] player: playing"));
  player.on(AudioPlayerStatus.AutoPaused, () =>
    console.warn("[voice] player: auto-paused — no subscriber? connection may have dropped"),
  );

  setActivePlayer(player);
  setActiveChannel(channel);

  function stop() {
    setActivePlayer(null);
    setActiveChannel(null);
    connection.destroy();
  }

  return { connection, player, stop };
}
