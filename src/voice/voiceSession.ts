import {
  joinVoiceChannel,
  EndBehaviorType,
  createAudioPlayer,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  type VoiceConnection,
  type AudioPlayer,
} from "@discordjs/voice";
import prism from "prism-media";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { VoiceBasedChannel } from "discord.js";

import {
  createRadioSession,
  handleTransmission,
  type RadioSessionState,
  type DispatchAction,
  type RadioDependencies,
} from "../radioSession.js";
import { matchIntent } from "../radioIntents.js";
import { transcribeWavPersistent } from "./sttServer.js";
import {
  findLinkByDiscordId,
  getCallsignsByDiscordId,
  assignUnitToCall,
  startTrafficStopRecord,
  getActiveTrafficStopForOfficer,
  recordTrafficStopPlate,
  assignUnitToTrafficStop,
  updateLiveUnitStatus,
} from "../db.js";
import { isPursuitActive } from "../pursuit.js";
import { containerMessage } from "../ui.js";
import { setActivePlayer, setActiveChannel, speakOn } from "./activeDispatcherRegistry.js";
import {
  findActiveCallByText,
  findActiveCallByCaseNumber,
  findActiveCallByPostal,
  declareCallFromVoice,
} from "../callDispatch.js";
import { getServerPlayers } from "../erlcClient.js";
import { findNearestUnit } from "../nearestUnit.js";
import { formatForSpeech } from "../speechFormat.js";

export interface VoiceDispatcherHandle {
  connection: VoiceConnection;
  player: AudioPlayer;
  session: RadioSessionState;
  stop: () => void;
}

// Real dependency wiring for the pure radioSession/radioIntents logic — kept out of those
// modules so they stay unit-testable against fixtures instead of the real database.
const radioDeps: RadioDependencies = {
  matcher: matchIntent,
  // Prefers a real assigned callsign; falls back to the linked Roblox username if the speaker
  // hasn't been assigned one yet. Never trusts digits parsed from speech for identity — matches
  // the speaker by their real Discord user ID instead, which we already know precisely from the
  // voice connection itself.
  resolveCallsign: async (discordId) => {
    const callsigns = await getCallsignsByDiscordId(discordId);
    if (callsigns.length > 0) return String(callsigns[0].number);
    return (await findLinkByDiscordId(discordId))?.roblox_username ?? null;
  },
  findActiveCall: findActiveCallByText,
  findActiveCallByCaseNumber,
  findActiveCallByPostal,
  declareCall: declareCallFromVoice,
  attachUnitToCall: assignUnitToCall,
  startTrafficStop: async (speakerId, postal, vehicleDescription) => {
    const id = randomUUID();
    await startTrafficStopRecord(id, speakerId, postal, vehicleDescription);
    return id;
  },
  getActiveTrafficStop: async (speakerId) => {
    const row = await getActiveTrafficStopForOfficer(speakerId);
    if (!row) return null;
    return { id: row.id, postal: row.postal ?? "unknown", vehicleDescription: row.vehicle_description ?? "unknown" };
  },
  recordTrafficStopPlate: async (trafficStopId, plate) => recordTrafficStopPlate(trafficStopId, plate),
  updateUnitStatus: async (speakerId, status, callId) => {
    const callsigns = await getCallsignsByDiscordId(speakerId);
    if (callsigns.length === 0) return; // no assigned callsign — nothing in live_units to update
    const cs = callsigns[0];
    await updateLiveUnitStatus(`${cs.department}-${cs.number}`, status, callId);
  },
  dispatchNearestUnitToTrafficStop: async (trafficStopId, requestingSpeakerId) => {
    const link = await findLinkByDiscordId(requestingSpeakerId);
    if (!link?.roblox_user_id) return null;

    const players = await getServerPlayers();
    const officerPlayer = players?.find((p) => p.Player.split(":")[1] === link.roblox_user_id);
    const x = officerPlayer?.Location?.LocationX;
    const z = officerPlayer?.Location?.LocationZ;
    if (x === undefined || z === undefined) return null;

    const nearest = await findNearestUnit(x, z, { excludeRobloxId: link.roblox_user_id });
    if (!nearest?.discordId) return null;

    await assignUnitToTrafficStop(trafficStopId, nearest.discordId);

    const nearestCallsigns = await getCallsignsByDiscordId(nearest.discordId);
    const label =
      nearestCallsigns.length > 0
        ? formatForSpeech(String(nearestCallsigns[0].number))
        : ((await findLinkByDiscordId(nearest.discordId))?.roblox_username ?? "unassigned unit");

    return { label, postal: nearest.player.PostalCode ?? "unknown" };
  },
};

// Playback mechanics (join, connect, synthesize, play) confirmed working via a direct self-test
// (bot joined a real empty channel, played a synthesized phrase, Buffering->Playing->Idle with
// no errors). What's still unverified is the receive side with a live human on a mic — see
// NEEDS_HUMAN_VERIFICATION.md for exact test steps.
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

  const session = createRadioSession();
  const receiver = connection.receiver;
  let stopped = false;

  setActivePlayer(player);
  setActiveChannel(channel);

  const onSpeakingStart = (userId: string) => {
    handleUtterance(userId).catch((err) => console.error(`[voice] utterance handling failed for ${userId}`, err));
  };
  receiver.speaking.on("start", onSpeakingStart);

  // Every processed transmission gets a text summary posted in the VC's own text chat — what was
  // heard (or why nothing was heard/acted on), not just a spoken response that's gone once said.
  async function postSummary(text: string) {
    if (!channel.isSendable()) return;
    try {
      await channel.send(containerMessage(text));
    } catch (err) {
      console.error("[voice] failed to post summary to channel", err);
    }
  }

  function describeAction(action: DispatchAction): string {
    return action.type === "say" ? `Said: "${action.text}"` : "No action taken.";
  }

  async function handleUtterance(userId: string) {
    if (stopped) return;

    // Only linked accounts get processed — mirrors the text-command permission gate.
    if (!(await findLinkByDiscordId(userId))) {
      await postSummary(`<@${userId}> spoke — ignored (not linked).`);
      return;
    }

    // Per the brief: while a pursuit is active, the bot stops listening/responding in RTO.
    // People can still talk to each other; we just don't process it. No channel permission
    // changes — this is purely "don't act on it."
    if (isPursuitActive()) {
      await postSummary(`<@${userId}> spoke — ignored (pursuit active, dispatch is quiet in RTO).`);
      return;
    }

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });
    // discord.js reuses the same underlying stream per user across utterances rather than handing
    // back a fresh one each time — confirmed live via a real MaxListenersExceededWarning once a
    // user had spoken enough times in one session for the default cap (10) to trip. Not an actual
    // leak (pipeline() below cleans up its own listeners each run), just a mismatch with the
    // default cap for a long-lived per-user stream.
    opusStream.setMaxListeners(50);

    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const ffmpeg = new prism.FFmpeg({
      args: [
        "-analyzeduration", "0",
        "-loglevel", "0",
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",
        "-i", "-",
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
      ],
    });

    const tmpPath = path.join(os.tmpdir(), `dcd-utterance-${randomUUID()}.wav`);

    try {
      await pipeline(opusStream, decoder, ffmpeg, createWriteStream(tmpPath));

      const { text: transcript, confidence } = await transcribeWavPersistent(tmpPath);
      if (!transcript) {
        await postSummary(`<@${userId}> spoke — no transcript produced (silence or inaudible).`);
        return;
      }

      console.log(`[voice] transcript from ${userId}: "${transcript}" (confidence=${confidence})`);
      const action = await handleTransmission(session, userId, transcript, radioDeps, confidence ?? undefined);

      const confidencePct = confidence !== null ? `${Math.round(confidence * 100)}%` : "n/a";
      await postSummary(`<@${userId}>: "${transcript}" (confidence ${confidencePct}) — ${describeAction(action)}`);

      if (action.type === "say") {
        await speakOn(player, action.text);
      }
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  function stop() {
    stopped = true;
    setActivePlayer(null);
    setActiveChannel(null);
    receiver.speaking.removeListener("start", onSpeakingStart);
    connection.destroy();
  }

  return { connection, player, session, stop };
}
