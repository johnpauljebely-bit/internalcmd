import type { IntentResult, IntentContext, ActiveCallInfo } from "./radioSession.js";
import { formatPlateForSpeech, formatForSpeech } from "./speechFormat.js";
import { normalizeSpokenDigits } from "./radioSession.js";

// Full 10-code list, per request — replaces the earlier generic BC/RCMP-style placeholder set.
export const TEN_CODES: Record<string, string> = {
  "10-0": "Use caution",
  "10-1": "Unable to understand / poor signal",
  "10-2": "Signal good",
  "10-3": "Stop transmitting",
  "10-4": "Acknowledged / OK",
  "10-5": "Relay message",
  "10-6": "Busy",
  "10-7": "Out of service",
  "10-8": "In service",
  "10-9": "Repeat",
  "10-10": "Fight in progress",
  "10-11": "Traffic stop",
  "10-12": "Stand by",
  "10-13": "Shots fired",
  "10-14": "Escort",
  "10-15": "Prisoner in custody",
  "10-16": "Pick up prisoner",
  "10-17": "Urgent",
  "10-18": "Complete assignment quickly",
  "10-19": "Return to station",
  "10-20": "Location",
  "10-21": "Call by phone",
  "10-22": "Cancel",
  "10-23": "Arrived on scene",
  "10-24": "Assignment complete",
  "10-25": "Meet/contact",
  "10-26": "ETA",
  "10-27": "Driver license check",
  "10-28": "Vehicle registration check",
  "10-29": "Wants / warrants check",
  "10-30": "Unnecessary use of radio",
  "10-31": "Crime in progress",
  "10-32": "Person with a gun",
  "10-33": "Emergency traffic only",
  "10-34": "Riot",
  "10-35": "Major crime alert",
  "10-36": "Correct time",
  "10-37": "Suspicious vehicle",
  "10-38": "Stopping suspicious vehicle",
  "10-39": "Urgent use of lights & siren",
  "10-40": "Silent run / no lights",
  "10-41": "Beginning tour of duty",
  "10-42": "Ending tour of duty",
  "10-43": "Information",
  "10-44": "Permission to leave",
  "10-45": "Condition of patient",
  "10-46": "Motorist assist",
  "10-47": "Emergency road repair",
  "10-48": "Traffic standard repair",
  "10-49": "Traffic light malfunction",
  "10-50": "Vehicle accident",
  "10-51": "Wrecker needed",
  "10-52": "Ambulance needed",
  "10-53": "Road blocked",
  "10-54": "Livestock on highway",
  "10-55": "Intoxicated driver",
  "10-56": "Intoxicated pedestrian",
  "10-57": "Hit and run",
  "10-58": "Traffic control",
  "10-59": "Escort",
  "10-60": "Squad in vicinity",
  "10-61": "Personnel in area",
  "10-62": "Reply to message",
  "10-63": "Prepare to copy",
  "10-64": "Message for delivery",
  "10-65": "Net message",
  "10-66": "Message cancellation",
  "10-67": "Clear to send",
  "10-68": "Dispatch information",
  "10-69": "Message received",
  "10-70": "Fire alarm",
  "10-71": "Supervisor request",
  "10-72": "Report progress of fire",
  "10-73": "Smoke report",
  "10-74": "Negative",
  "10-75": "In contact",
  "10-77": "ETA",
  "10-78": "Need assistance",
  "10-79": "Notify coroner",
  "10-80": "Pursuit in progress",
  "10-81": "Breathalyzer report",
  "10-82": "Reserve lodging",
  "10-83": "Work school crossing",
  "10-84": "If meeting, advise ETA",
  "10-85": "Delayed",
  "10-86": "Officer/operator on duty",
  "10-87": "Pickup / distribute checks",
  "10-88": "Phone number request",
  "10-89": "Bomb threat",
  "10-90": "Bank alarm",
  "10-91": "Pick up subject",
  "10-92": "Improperly parked vehicle",
  "10-93": "Blockade",
  "10-94": "Drag racing",
  "10-95": "Prisoner transport",
  "10-96": "Mental subject",
  "10-97": "Enroute",
  "10-98": "Assignment finished",
  "10-99": "Officer in danger",
  "10-100": "Restroom break",
};

function normalize(transcript: string): string {
  return transcript.trim().toLowerCase().replace(/[.,!?]+$/g, "");
}

const TENS_WORD_VALUES = new Set(["20", "30", "40", "50", "60", "70", "80", "90"]);

// Confirmed live: Vosk transcribes spoken numbers as WORDS ("ten eight", "ten dash eight"), not
// digit characters — every "10-XX" check below was matching literal digits and silently missing
// almost all real speech as a result ("show me ten eight" → unrecognized → "please repeat", every
// time). This normalizes a transcript for 10-code matching: word→digit via normalizeSpokenDigits
// (handles "ten"→"10", "eight"→"8"), then merges a spoken compound two-digit number that comes out
// as two separate tokens ("twenty"+"eight" → "20" "8") back into one ("28") — needed for codes
// like 10-28, 10-32 read as "ten twenty eight"/"thirty two". Only merges an actual tens-word
// (20-90) immediately followed by a unit digit, so it never touches digit-by-digit callsign speech
// (no tens-words there) or digit-by-digit code reading like "ten eight" for 10-8 (10 isn't a tens
// value in this set, so "10 8" is deliberately left alone).
function normalizeForTenCode(text: string): string {
  const digitsNormalized = normalizeSpokenDigits(text);
  const merged = digitsNormalized.replace(/\b(20|30|40|50|60|70|80|90)\s+([1-9])\b/g, (_match, tens, unit) =>
    TENS_WORD_VALUES.has(tens) ? String(Number(tens) + Number(unit)) : `${tens} ${unit}`,
  );
  return merged.replace(/\bdash\b/gi, "-");
}

function extractTenCode(text: string): string | null {
  const match = normalizeForTenCode(text).match(/\b10[\s-]*(\d{1,3})\b/);
  return match ? `10-${match[1]}` : null;
}

// Every matcher below searches for its key signal word ANYWHERE in the transcript rather than
// requiring the whole utterance to match a rigid template — real speech has filler words
// ("um", "can you", "for me") the old exact-phrase matchers would reject outright as
// "unrecognized" even though the intent was obvious. The goal is "what's the most likely thing
// they meant," not "does this match one exact phrasing."
//
// Dispatch's voice/identity: calm, efficient, professional — a real dispatcher, not a search
// engine reading back matches. Established core protocol phrasing (10-4/10-9/go-ahead/please
// hold) stays exactly as specified elsewhere; personality shows up in how new scenarios like the
// traffic-stop flow below are worded — natural and warm without being chatty.

// Answers a pending "do you need additional units?" question (asked after a plate check during
// an active traffic stop). Checked first, ahead of the normal priority list, whenever
// pendingFollowUpTag is set — the reply is expected to be a yes/no, not a fresh command.
async function matchAdditionalUnitsAnswer(text: string, context: IntentContext): Promise<IntentResult | null> {
  if (context.pendingFollowUpTag !== "additional-units") return null;

  const wantsBackup = /\b(32s?|yes|yeah|affirmative|please|need (one|units?|backup)|send)\b/.test(
    normalizeForTenCode(text),
  );
  const declines = /\b(no|negative|negatory|nope|don'?t need|i'?m good|solo)\b/.test(text);

  if (declines && !wantsBackup) {
    return { kind: "recognized", responseText: "Copy, solo on scene." };
  }

  if (!wantsBackup) {
    // Ambiguous — this dispatches a real unit if wrong, so ask again rather than guess.
    return {
      kind: "recognized",
      responseText: "Copy — do you need additional units, yes or no?",
      needsFollowUp: true,
      followUpTag: "additional-units",
    };
  }

  const stop = await context.getActiveTrafficStop(context.speakerId);
  if (!stop) {
    return { kind: "recognized", responseText: "No active traffic stop on file for you.", skipAck: true };
  }

  const nearest = await context.dispatchNearestUnitToTrafficStop(stop.id, context.speakerId);
  if (!nearest) {
    return { kind: "recognized", responseText: "Copy, no other units available to send right now." };
  }

  return {
    kind: "recognized",
    responseText: `Copy. ${nearest.label}, attach and enroute to postal ${formatForSpeech(nearest.postal)} to assist ${context.spokenCallsign}.`,
    skipAck: true,
  };
}

// "2200 traffic stop when ready" -> go-ahead (handled by the handshake) -> "I'll be on a 10-11
// postal 910 highway 55 with a red 4-door sedan. 28 when ready" -> this matcher. Extracts postal
// + vehicle description, opens a traffic stop record, and if a plate readout was flagged ("28")
// invites it immediately — otherwise just logs it.
async function matchTrafficStopReport(text: string, context: IntentContext): Promise<IntentResult | null> {
  if (!/\b10[\s-]*11\b/.test(normalizeForTenCode(text))) return null;

  const postalMatch = text.match(/postal\s+(\d+)/i);
  const postal = postalMatch ? postalMatch[1] : "unknown";

  const vehicleMatch = text.match(/with\s+(?:a\s+)?(.+?)(?:\s*[.,]\s*28\b|[.,]?\s*$)/i);
  const vehicleDescription = vehicleMatch ? vehicleMatch[1].trim() : "unknown vehicle";

  await context.startTrafficStop(context.speakerId, postal, vehicleDescription);

  const wantsPlateNext = /\b28\b/.test(normalizeForTenCode(text));
  return {
    kind: "recognized",
    responseText: wantsPlateNext ? "28, go ahead." : "Logged, be safe out there.",
    needsFollowUp: wantsPlateNext,
  };
}

// Shared by matchAttachToCall and matchStatusUpdate — when a postal is given but nothing's on
// file there, self-declares the call rather than dispatch drawing a blank (see declareCall's own
// doc comment in radioSession.ts for the full reasoning — this is specifically what makes
// "attach me to the panic at postal X" work even though ER:LC panic events have never been
// confirmed to exist, let alone arrive automatically).
async function findOrDeclareCallByPostal(
  context: IntentContext,
  postal: string,
  description: string,
): Promise<ActiveCallInfo> {
  const existing = await context.findActiveCallByPostal(postal);
  if (existing) return existing;
  return context.declareCall(context.speakerId, description, postal);
}

// Attaches the speaker to an active call, by exact case number ("1050 to dispatch attach me to
// case #4521"), by postal ("attach me to the panic at postal 910" — self-declares the call if
// dispatch has nothing on file there), or by fuzzy description match against known call
// descriptions ("1409 attach to the robbery") as the last resort. The leading callsign is just
// protocol habit — who's actually speaking is already known from context, never re-parsed from
// this text. Allows a run of filler connector words ("attach me to case...") rather than just
// one, since real speech stacks them. Records the assignment and responds with the real callsign,
// not wrapped in the usual "10-4, I understand" ack — this constructs its own complete sentence.
async function matchAttachToCall(text: string, context: IntentContext): Promise<IntentResult | null> {
  const match = text.match(/\battach(?:\s+(?:to|too|i|a|uh|me))*\s+(.+)$/);
  if (!match) return null;

  const rest = match[1];

  // Case number may be spoken digit-by-digit or as compound number words ("four five two one" /
  // "forty five twenty one") — normalize before stripping to a bare digit string for lookup.
  const caseMatch = rest.match(/\bcase\s*(?:#|number|num)?\s*(.+)$/i);
  if (caseMatch) {
    const call = await context.findActiveCallByCaseNumber(normalizeSpokenDigits(caseMatch[1].trim()).replace(/\s+/g, ""));
    return respondToAttach(call, rest, context);
  }

  // "postal N" or a bare "at N" — real phrasing varies ("attach me to the panic at postal 910"
  // vs. "attach me to the panic at 910"), don't require the literal word "postal".
  const postalMatch = rest.match(/\b(?:postal|at)\s+(\d{2,5})\b/i);
  if (postalMatch) {
    const description = rest.replace(/\b(the|to|at)?\s*(?:postal|at)\s+\d+\b/i, "").trim() || "reported incident";
    const call = await findOrDeclareCallByPostal(context, postalMatch[1], description);
    return respondToAttach(call, rest, context);
  }

  const call = await context.findActiveCall(rest);
  return respondToAttach(call, rest, context);
}

async function respondToAttach(call: ActiveCallInfo | null, rest: string, context: IntentContext): Promise<IntentResult> {
  if (!call) {
    return {
      kind: "recognized",
      responseText: `No active call matching "${rest.trim()}" found.`,
      skipAck: true,
    };
  }

  await context.attachUnitToCall(call.id, context.speakerId);
  await context.updateUnitStatus(context.speakerId, "enroute", call.id);
  const postal = formatForSpeech(call.postal ?? "unknown");
  return {
    kind: "recognized",
    responseText: `${context.spokenCallsign} is now enroute to postal ${postal}, case number ${formatForSpeech(call.id)}.`,
    skipAck: true,
  };
}

// No persisted BOLO/plate database exists yet — this always reports "nothing on file" rather
// than fabricating a hit. Wire to a real BOLO store once one exists. Triggers on either "plate"
// or a bare "28" (10-28, vehicle registration check) — but "28" alone only counts as a trigger
// during an active traffic stop, otherwise it's too ambiguous with an actual "10-28" 10-code
// mention elsewhere. Within a traffic stop, also asks whether backup's needed next.
async function matchPlateCheck(text: string, context: IntentContext): Promise<IntentResult | null> {
  // "28" the code is commonly spoken as the compound word "twenty eight," not literal digits
  // (confirmed live for other 10-codes — see normalizeForTenCode). Normalize once and use it for
  // both the trigger check AND the extraction regex below — "plate" itself and the plate value
  // are ordinary words/alphanumerics, unaffected by the normalization either way.
  const normalized = normalizeForTenCode(text);
  const stop = await context.getActiveTrafficStop(context.speakerId);
  const triggersOnPlateWord = /\bplate\b/.test(normalized);
  const triggersOn28 = stop !== null && /\b28\b/.test(normalized);
  if (!triggersOnPlateWord && !triggersOn28) return null;

  const match = normalized.match(
    /(?:\bplate\b(?:\s+(?:is|number|for|on))?|\b28\b(?:\s+reading)?)\s+((?=[a-z0-9-]*\d)[a-z0-9][a-z0-9-]{1,9})\b/,
  );
  if (!match) {
    // Signal word present but no plate string could be pulled out — ask, don't give up.
    return { kind: "recognized", responseText: "What's the plate number?", needsFollowUp: true };
  }

  // Spoken with the NATO phonetic alphabet, per request — this text is what gets said out loud.
  const plateLine = `Plate ${formatPlateForSpeech(match[1])}, nothing on file.`;

  if (stop) {
    await context.recordTrafficStopPlate(stop.id, match[1].toUpperCase());
    return {
      kind: "recognized",
      responseText: `${plateLine} Do you need additional units?`,
      needsFollowUp: true,
      followUpTag: "additional-units",
    };
  }

  return { kind: "recognized", responseText: plateLine };
}

// Per the CAD website's 5-state duty-status model (available/unavailable/busy/enroute/on_scene —
// see delta-city-cad/src/lib/unitStatus.ts) — these 10-codes map directly onto it, so reporting
// one updates the same status shown live on the CAD dashboard, not just a spoken ack that goes
// nowhere.
const TEN_CODE_TO_STATUS: Record<string, string> = {
  "10-8": "available",
  "10-7": "unavailable",
  "10-6": "busy",
  "10-97": "enroute",
  "10-23": "on_scene",
};

// Plain-English phrasing for the same 5 states — real speech ("show me enroute") is at least as
// common as the 10-code form.
const STATUS_WORD_PATTERNS: [RegExp, string][] = [
  [/\bunavailable\b/, "unavailable"],
  [/\bavailable\b/, "available"],
  [/\bbusy\b/, "busy"],
  [/\ben\s*route\b/, "enroute"],
  [/\bon[\s-]?scene\b/, "on_scene"],
];

// Status updates now do two things: speak an ack, and persist the actual status (and, when a call
// is identified alongside it, call_id) into the CAD's live_units — not just a spoken "logged" that
// goes nowhere. Recognizes both 10-code and plain-English phrasing of the 5-state model; anything
// else falls back to the older free-text "status is ..." logging, which has no CAD-side field to
// persist into.
async function matchStatusUpdate(text: string, context: IntentContext): Promise<IntentResult | null> {
  // "what does 10-8 mean" is a definition query, not a status report, even though it mentions a
  // status-mappable code — matchTenCodeQuery handles it instead.
  const isDefinitionQuery = /\b(what|mean|means|code)\b/.test(text);

  const code = isDefinitionQuery ? null : extractTenCode(text);
  let status = code ? TEN_CODE_TO_STATUS[code] : undefined;

  // A bare 10-code is unambiguous on its own (real radio convention — just saying the code IS the
  // report). "Enroute"/"on scene" are specific enough dispatch terms to stand alone too. Only
  // "available"/"unavailable"/"busy" are common enough English words on their own that they need
  // "status" or "show (me)" alongside them as an actual signal word, to avoid false-triggering on
  // unrelated chatter that happens to contain one of those words.
  let requiresSignalWord = false;
  if (!status) {
    for (const [pattern, value] of STATUS_WORD_PATTERNS) {
      if (pattern.test(text)) {
        status = value;
        requiresSignalWord = value === "available" || value === "unavailable" || value === "busy";
        break;
      }
    }
  }

  const hasSignalWord = /\b(status|show)\b/.test(text);

  if (status && (!requiresSignalWord || hasSignalWord)) {
    // Optionally attach to a specific call by postal, spoken alongside the status. Real phrasing
    // varies a lot here ("...to the call at postal 910", "...en route to postal 910", "...en
    // route to that call at 910" — confirmed by the user's own examples, none of which use
    // identical wording) — so this deliberately does NOT require the literal word "call", and
    // accepts "at N" as well as "postal N". Only attempted for statuses that make sense tied to a
    // specific call (enroute/on_scene/busy) — "available"/"unavailable" imply NOT working one.
    const postalMatch = text.match(/\b(?:postal|at)\s+(\d{2,5})\b/i);
    let attachedCall: ActiveCallInfo | null = null;
    let noCallAtPostal: string | null = null;
    if (postalMatch && (status === "enroute" || status === "on_scene" || status === "busy")) {
      // Unlike matchAttachToCall (which self-declares — its whole point is reporting something
      // new like an unconfirmed panic), this phrasing presumes an existing call ("the call at
      // postal X") — report absence rather than fabricating one if there's genuinely nothing there.
      const found = await context.findActiveCallByPostal(postalMatch[1]);
      if (found) {
        attachedCall = found;
        await context.attachUnitToCall(found.id, context.speakerId);
      } else {
        noCallAtPostal = postalMatch[1];
      }
    }

    // "available" implies done with whatever call they had — clear it. Otherwise only touch
    // call_id if this utterance actually identified one; leave it alone otherwise ("show me busy"
    // shouldn't silently detach someone from a call they're still working).
    const callIdForStatus = status === "available" ? null : attachedCall ? attachedCall.id : undefined;
    await context.updateUnitStatus(context.speakerId, status, callIdForStatus);

    if (attachedCall) {
      return {
        kind: "recognized",
        responseText: `${context.spokenCallsign} is now ${status.replace("_", " ")}, postal ${formatForSpeech(attachedCall.postal ?? "unknown")}, case number ${formatForSpeech(attachedCall.id)}.`,
        skipAck: true,
      };
    }

    if (noCallAtPostal) {
      return {
        kind: "recognized",
        responseText: `${context.spokenCallsign}, I don't have a call at postal ${formatForSpeech(noCallAtPostal)} — status updated to ${status.replace("_", " ")} anyway.`,
        skipAck: true,
      };
    }

    return { kind: "recognized", responseText: `${context.spokenCallsign}.` };
  }

  // Fall back to the older free-text logging for anything status-worded but not one of the 5
  // known states (e.g. "status is on the way to backup") — no CAD-side field for this, so it
  // stays spoken-only, same as it always was.
  if (!/\bstatus\b/.test(text)) return null;

  const match = text.match(/\bstatus\b\s+(?:is\s+|update\s+)?(.+)$/);
  const rest = match?.[1]?.trim();
  if (rest) return { kind: "recognized", responseText: `Copy, status ${rest} logged.` };

  return { kind: "recognized", responseText: "What's your status?", needsFollowUp: true };
}

function matchTenCodeQuery(text: string): IntentResult | null {
  const code = extractTenCode(text);
  if (!code) return null;

  // Distinguishes "what's 10-4" (a query) from "status 10-8" (a status update, handled above) —
  // needs a question-shaped signal word, not just any mention of a 10-code. "show (me)" counts too
  // (confirmed live: "show me 10-8" was falling through to unrecognized).
  if (!/\b(what|mean|means|code|show)\b/.test(text)) return null;

  const meaning = TEN_CODES[code];
  return meaning
    ? { kind: "recognized", responseText: `${code} is ${meaning}.` }
    : { kind: "recognized", responseText: `I don't have a definition on file for ${code}.` };
}

export async function matchIntent(transcript: string, context: IntentContext): Promise<IntentResult> {
  const text = normalize(transcript);

  if (context.pendingFollowUpTag) {
    const answer = await matchAdditionalUnitsAnswer(text, context);
    if (answer) return answer;
  }

  // Some matchers are async (they touch context DB fields), some aren't (matchStatusUpdate/
  // matchTenCodeQuery only look at the text) — awaiting unconditionally is safe either way
  // (awaiting a non-Promise value just resolves immediately) and avoids the bug this loop used to
  // have latent: checking `if (result)` against an un-awaited Promise object is always truthy,
  // which would silently short-circuit on the wrong matcher the moment any of them went async.
  for (const matcher of [matchTrafficStopReport, matchAttachToCall, matchPlateCheck, matchStatusUpdate, matchTenCodeQuery]) {
    const result = await matcher(text, context);
    if (result) return result;
  }

  return { kind: "unrecognized" };
}
