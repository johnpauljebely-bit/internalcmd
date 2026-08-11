// Half-duplex radio protocol state machine, per the brief: callsign handshake, one active
// speaker at a time, FIFO hold queue for others keying up mid-exchange, ask-to-repeat on
// unrecognized transcripts, 10-4 acknowledgment. Pure logic — takes already-transcribed text in,
// returns what dispatch should say (if anything). No audio/STT/TTS here.

import { formatForSpeech } from "./speechFormat.js";

export interface IntentResult {
  kind: "recognized" | "unrecognized";
  responseText?: string;
  needsFollowUp?: boolean;
  // Identifies WHAT is being followed up on, so the next turn can route straight to a dedicated
  // handler instead of re-running the normal intent-matching order (e.g. "additional-units" —
  // the next utterance should be interpreted as a yes/no answer, not a fresh command).
  followUpTag?: string;
  // Bypasses the "10-4, I understand." prefix — for intents that construct their own complete
  // spoken sentence (e.g. "attach to call": "{callsign} is now enroute to postal {x}.").
  skipAck?: boolean;
}

export interface ActiveCallInfo {
  id: string;
  postal: string | null;
}

export interface ActiveTrafficStopInfo {
  id: string;
  postal: string;
  vehicleDescription: string;
}

export interface NearestUnitDispatchResult {
  label: string; // already speech-formatted (digit-by-digit callsign, or a plain username)
  postal: string;
}

// All DB/external lookups matchers might need, injected rather than imported directly — keeps
// radioIntents.ts a pure, fully unit-testable module with no real database dependency (matchers
// run against fixtures in tests, real implementations only in production wiring).
export interface IntentContext {
  speakerId: string;
  spokenCallsign: string;
  // Set when the PREVIOUS turn asked a specific follow-up question this turn should answer —
  // null otherwise.
  pendingFollowUpTag: string | null;
  // All now async — real implementations hit a real Postgres database (see db.ts), not just an
  // in-process SQLite call. Fixtures in tests just return already-resolved promises.
  findActiveCall: (query: string) => Promise<ActiveCallInfo | null>;
  findActiveCallByCaseNumber: (caseNumber: string) => Promise<ActiveCallInfo | null>;
  findActiveCallByPostal: (postal: string) => Promise<ActiveCallInfo | null>;
  // For when dispatch has no record of what's being reported (e.g. a panic/officer-down that
  // never came through as a confirmed ER:LC webhook event — see NEEDS_HUMAN_VERIFICATION.md, that
  // event shape has never been observed live) — the reporting officer's own transmission becomes
  // the record instead of dispatch just not knowing what call someone means. Broadcasts to other
  // units the same way an ER:LC-sourced call does (RTO text + in-game PA), just not a second
  // spoken announcement through this same voice session (would collide with the direct response
  // already being spoken back to the reporting officer on the same audio player).
  declareCall: (speakerId: string, description: string, postal: string) => Promise<ActiveCallInfo>;
  attachUnitToCall: (callId: string, speakerId: string) => Promise<void>;
  startTrafficStop: (speakerId: string, postal: string, vehicleDescription: string) => Promise<string>;
  getActiveTrafficStop: (speakerId: string) => Promise<ActiveTrafficStopInfo | null>;
  recordTrafficStopPlate: (trafficStopId: string, plate: string) => Promise<void>;
  // Writes into the CAD's live_units.status/call_id (available/unavailable/busy/enroute/on_scene)
  // so a spoken status report shows up on the CAD dashboard in real time, not just as an ack.
  // `callId`: omit to leave call_id untouched, `null` to clear it, a string to attach one.
  updateUnitStatus: (speakerId: string, status: string, callId?: string | null) => Promise<void>;
  // Async — finding the nearest unit means a live ER:LC API call, not just a DB read.
  dispatchNearestUnitToTrafficStop: (
    trafficStopId: string,
    requestingSpeakerId: string,
  ) => Promise<NearestUnitDispatchResult | null>;
}

// Async because some matchers (nearest-unit dispatch) need a live API call, not just DB reads.
export type IntentMatcher = (
  transcript: string,
  context: IntentContext,
) => IntentResult | Promise<IntentResult>;

// Looks up the speaker's REAL assigned callsign (or failing that, their username) by their
// Discord user ID — the spoken digits are only used to detect that a handshake was attempted,
// never trusted for who's actually talking. STT digit errors are common enough (confirmed live)
// that addressing someone by whatever number was guessed from their speech was actively wrong;
// we already know exactly who's speaking from the Discord voice connection itself.
export type CallsignResolver = (speakerId: string) => Promise<string | null>;

// Bundled rather than passed positionally — handleTransmission's dependency list kept growing
// (callsign lookup, call lookup/assignment, traffic-stop tracking) and a growing positional arg
// list gets error-prone to call correctly.
export interface RadioDependencies {
  matcher: IntentMatcher;
  resolveCallsign: CallsignResolver;
  findActiveCall: IntentContext["findActiveCall"];
  findActiveCallByCaseNumber: IntentContext["findActiveCallByCaseNumber"];
  findActiveCallByPostal: IntentContext["findActiveCallByPostal"];
  declareCall: IntentContext["declareCall"];
  attachUnitToCall: IntentContext["attachUnitToCall"];
  startTrafficStop: IntentContext["startTrafficStop"];
  getActiveTrafficStop: IntentContext["getActiveTrafficStop"];
  recordTrafficStopPlate: IntentContext["recordTrafficStopPlate"];
  updateUnitStatus: IntentContext["updateUnitStatus"];
  dispatchNearestUnitToTrafficStop: IntentContext["dispatchNearestUnitToTrafficStop"];
  // Optional last-resort fallback for when the rules engine can't match anything at all — gets
  // one attempt at a smarter answer (real-world knowledge + live in-game context) before falling
  // back to "10-9, please repeat." Must resolve to null rather than throw on any failure
  // (unreachable/timeout/etc.) — omit entirely (undefined) to skip straight to "please repeat",
  // same as today, e.g. in tests.
  generateAiFallback?: (transcript: string, spokenCallsign: string) => Promise<string | null>;
}

export type DispatchAction = { type: "say"; text: string } | { type: "ignore" };

interface QueueEntry {
  speakerId: string;
  callsign: string;
}

export interface RadioSessionState {
  activeSpeaker: { speakerId: string; callsign: string } | null;
  holdQueue: QueueEntry[];
  pendingFollowUpTag?: string;
}

export function createRadioSession(): RadioSessionState {
  return { activeSpeaker: null, holdQueue: [] };
}

// Below this, "say again" without even attempting to match intent — don't guess from a shaky
// transcript. Unconfirmed/untuned until real Vosk confidence scores are available to calibrate
// against.
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  // Compound words — real speech doesn't reliably stay digit-by-digit even when asked to
  // (confirmed live: "fourteen" instead of "one four"). Each expands to its own digit string.
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90",
};

// Real radio convention is to say callsigns digit-by-digit ("one four zero nine"), and that's
// confirmed to transcribe best — but real speech doesn't reliably stick to it (confirmed live:
// "fourteen" said as one word), so this expands compound number words too, not just single
// digits. Still accepts literal digit strings as well.
export function normalizeSpokenDigits(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => DIGIT_WORDS[word.toLowerCase()] ?? word)
    .join(" ");
}

// "to" before "dispatch" is one of the words most likely to get mangled or dropped by STT
// (confirmed live: transcribed as "i"). Treat the connector as optional/fuzzy rather than a
// hard literal match.
const CONNECTOR = "(?:to|too|i|a|uh)?";

// The trailing phrase that completes a handshake — heading to dispatch generally (either cue word
// works, "central" added per request — some officers just don't say "dispatch"), or straight into
// a traffic stop report ("2200 traffic stop when ready").
const HANDSHAKE_SUFFIX = "(?:dispatch|central|traffic\\s+stop(?:\\s+when\\s+ready)?)";

// Matches "[callsign] to dispatch" (or "... traffic stop when ready") — flexible whitespace/
// punctuation/connector word, callsign is 3-4 digits, spoken digit-by-digit, as compound number
// words, or as a literal digit string.
export function matchCallIn(transcript: string): string | null {
  const trimmed = transcript.trim();

  const directMatch = trimmed.match(new RegExp(`^(\\d{3,4})\\s*${CONNECTOR}\\s*${HANDSHAKE_SUFFIX}\\.?$`, "i"));
  if (directMatch) return directMatch[1];

  const normalized = normalizeSpokenDigits(trimmed);
  const spokenMatch = normalized.match(
    new RegExp(`^((?:\\d{1,2}\\s+){1,3}\\d{1,2})\\s*${CONNECTOR}\\s*${HANDSHAKE_SUFFIX}\\.?$`, "i"),
  );
  if (spokenMatch) {
    const digits = spokenMatch[1].replace(/\s+/g, "");
    if (digits.length === 3 || digits.length === 4) return digits;
  }

  return null;
}

// Same handshake detection as matchCallIn, but (a) doesn't require digits at all — a bare cue
// word ("dispatch" / "central", the callsign is already known from who's actually speaking, see
// resolveCallsign) counts on its own — and (b) doesn't anchor to the end of the transcript, so
// "1500 to dispatch show me 10-8" is recognized as a handshake AND the command is captured as
// `remainder`, instead of forcing a separate turn just to say "go ahead" first (confirmed live:
// this was the #1 complaint — real people don't split it into two breaths).
// Zero or more filler words before the handshake proper — confirmed live that STT regularly
// prepends junk like "the" ahead of a digit-word callsign ("the one zero five zero dispatch"),
// not just conversational fillers like "uh"/"um".
const LEADING_FILLER = "(?:(?:hey|uh|um|the|so)\\s+)*";

export function matchCallInPrefix(transcript: string): { remainder: string } | null {
  const trimmed = transcript.trim();

  const directMatch = trimmed.match(
    new RegExp(`^${LEADING_FILLER}(?:\\d{3,4}\\s*${CONNECTOR}\\s*)?${HANDSHAKE_SUFFIX}\\b[.,]?\\s*(.*)$`, "i"),
  );
  if (directMatch) return { remainder: directMatch[1].trim() };

  const normalized = normalizeSpokenDigits(trimmed);
  const spokenMatch = normalized.match(
    new RegExp(
      `^${LEADING_FILLER}(?:(?:\\d{1,2}\\s+){1,3}\\d{1,2}\\s*${CONNECTOR}\\s*)?${HANDSHAKE_SUFFIX}\\b[.,]?\\s*(.*)$`,
      "i",
    ),
  );
  if (spokenMatch) return { remainder: spokenMatch[1].trim() };

  return null;
}

// Runs the rules engine against the CURRENT active speaker's message and resolves the exchange
// (ack/follow-up/hold-queue pop). Pulled out of handleTransmission so the same logic can run
// either after a separate "go ahead" turn, or immediately when a handshake and its command arrive
// together in one utterance ("1500 to dispatch show me 10-8").
async function processActiveSpeakerCommand(
  state: RadioSessionState,
  speakerId: string,
  transcript: string,
  deps: RadioDependencies,
  confidence?: number,
): Promise<DispatchAction> {
  const {
    matcher,
    findActiveCall,
    findActiveCallByCaseNumber,
    findActiveCallByPostal,
    declareCall,
    attachUnitToCall,
    startTrafficStop,
    getActiveTrafficStop,
    recordTrafficStopPlate,
    updateUnitStatus,
    dispatchNearestUnitToTrafficStop,
  } = deps;

  // activeSpeaker is guaranteed set by both call sites (either it was already active, or we just
  // set it moments ago as part of a combined handshake+command utterance).
  const activeLabel = state.activeSpeaker!.callsign;
  const spokenActiveLabel = formatForSpeech(activeLabel);

  if (confidence !== undefined && confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { type: "say", text: `10-9, please repeat, ${spokenActiveLabel}.` };
  }

  // An empty remainder means a bare "dispatch"/"central" handshake with nothing else said yet —
  // just the go-ahead, don't run the rules engine against nothing.
  if (!transcript.trim()) {
    return { type: "say", text: `${spokenActiveLabel}, go ahead.` };
  }

  const result = await matcher(transcript, {
    speakerId,
    spokenCallsign: spokenActiveLabel,
    pendingFollowUpTag: state.pendingFollowUpTag ?? null,
    findActiveCall,
    findActiveCallByCaseNumber,
    findActiveCallByPostal,
    declareCall,
    attachUnitToCall,
    startTrafficStop,
    getActiveTrafficStop,
    recordTrafficStopPlate,
    updateUnitStatus,
    dispatchNearestUnitToTrafficStop,
  });

  if (result.kind === "unrecognized") {
    return { type: "say", text: `10-9, please repeat, ${spokenActiveLabel}.` };
  }

  const responseText = result.skipAck
    ? (result.responseText ?? "")
    : `10-4, I understand. ${result.responseText ?? ""}`.trim();

  if (result.needsFollowUp) {
    // Exchange continues — same active speaker, no queue pop.
    state.pendingFollowUpTag = result.followUpTag;
    return { type: "say", text: responseText };
  }

  // Exchange resolved.
  state.pendingFollowUpTag = undefined;
  state.activeSpeaker = null;
  const next = state.holdQueue.shift();
  if (next) {
    state.activeSpeaker = { speakerId: next.speakerId, callsign: next.callsign };
    return { type: "say", text: `${responseText} ${formatForSpeech(next.callsign)}, go ahead.` };
  }
  return { type: "say", text: responseText };
}

export async function handleTransmission(
  state: RadioSessionState,
  speakerId: string,
  transcript: string,
  deps: RadioDependencies,
  confidence?: number,
): Promise<DispatchAction> {
  const { resolveCallsign } = deps;
  const prefixMatch = matchCallInPrefix(transcript);
  const callInAttempted = matchCallIn(transcript) !== null || prefixMatch !== null;

  // No active speaker — only a call-in handshake is processed. Anything else is ignored, EXCEPT
  // an attempt that clearly mentions "dispatch"/"central" but didn't parse as a valid handshake —
  // that gets a spoken hint instead of dead silence, since silence reads as "broken" rather than
  // "waiting for the right phrasing" (confirmed real confusion from a garbled attempt). The
  // callsign is always resolved from who's ACTUALLY speaking (resolveCallsign), never from
  // digits parsed out of the transcript — so a bare "dispatch"/"central" with no digits at all
  // works fine, and so does the handshake and the actual command arriving in one breath.
  if (!state.activeSpeaker) {
    if (prefixMatch) {
      const label = (await resolveCallsign(speakerId)) ?? "unassigned unit";
      state.activeSpeaker = { speakerId, callsign: label };
      state.pendingFollowUpTag = undefined;
      return processActiveSpeakerCommand(state, speakerId, prefixMatch.remainder, deps, confidence);
    }
    if (/dispatch|central/i.test(transcript)) {
      return {
        type: "say",
        text: "Say your callsign followed by dispatch or central — for example, one four zero nine dispatch.",
      };
    }
    return { type: "ignore" };
  }

  // Someone other than the active speaker is transmitting.
  if (state.activeSpeaker.speakerId !== speakerId) {
    if (!callInAttempted) return { type: "ignore" };
    const label = (await resolveCallsign(speakerId)) ?? "unassigned unit";
    if (!state.holdQueue.some((q) => q.speakerId === speakerId)) {
      state.holdQueue.push({ speakerId, callsign: label });
    }
    return { type: "say", text: `${formatForSpeech(label)}, please hold.` };
  }

  // This is the active speaker's message.
  return processActiveSpeakerCommand(state, speakerId, transcript, deps, confidence);
}
