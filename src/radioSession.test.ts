import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRadioSession,
  handleTransmission,
  matchCallIn,
  type IntentMatcher,
  type CallsignResolver,
  type RadioDependencies,
  type ActiveCallInfo,
} from "./radioSession.js";

const alwaysRecognized: IntentMatcher = () => ({ kind: "recognized", responseText: "handled." });
const alwaysUnrecognized: IntentMatcher = () => ({ kind: "unrecognized" });

// Real DB lookups are replaced with fixtures for tests — matches speakerId to a real assigned
// callsign, mirroring "fetch from username/assigned callsign" in production.
const roster: Record<string, string> = {
  "user-1409": "1409",
  "user-1378": "1378",
};
const resolveFromRoster: CallsignResolver = async (speakerId) => roster[speakerId] ?? null;

function makeDeps(overrides: Partial<RadioDependencies> = {}): RadioDependencies {
  return {
    matcher: alwaysRecognized,
    resolveCallsign: resolveFromRoster,
    findActiveCall: async () => null,
    findActiveCallByCaseNumber: async () => null,
    findActiveCallByPostal: async () => null,
    declareCall: async (_speakerId, _description, postal) => ({ id: "declared-1", postal }),
    attachUnitToCall: async () => {},
    startTrafficStop: async () => "stop-1",
    getActiveTrafficStop: async () => null,
    recordTrafficStopPlate: async () => {},
    updateUnitStatus: async () => {},
    dispatchNearestUnitToTrafficStop: async () => null,
    ...overrides,
  };
}

test("matchCallIn extracts a callsign from the handshake phrase (literal digits)", () => {
  assert.equal(matchCallIn("1409 to dispatch"), "1409");
  assert.equal(matchCallIn("1409 to dispatch."), "1409");
  assert.equal(matchCallIn("  1409   to   dispatch  "), "1409");
  assert.equal(matchCallIn("hey what's up"), null);
});

// Real radio convention is digit-by-digit, and this is what actual Vosk STT output looks like
// for it (confirmed against a synthetic "one four zero nine to dispatch" utterance) — whole
// numbers like "1409" get badly mis-transcribed as "the thousand and four hundred and nine".
test("matchCallIn extracts a callsign from spoken digit-words", () => {
  assert.equal(matchCallIn("one four zero nine to dispatch"), "1409");
  assert.equal(matchCallIn("One Four Zero Nine to dispatch"), "1409");
  assert.equal(matchCallIn("one two zero zero to dispatch"), "1200");
  assert.equal(matchCallIn("two two zero zero to dispatch"), "2200");
  assert.equal(matchCallIn("four zero zero to dispatch"), "400"); // 3-digit Delta PD callsign
});

test("matchCallIn tolerates STT mangling the connector word 'to' (confirmed live: transcribed as 'i')", () => {
  assert.equal(matchCallIn("one four zero nine i dispatch"), "1409");
  assert.equal(matchCallIn("one four zero nine a dispatch"), "1409");
  assert.equal(matchCallIn("one four zero nine uh dispatch"), "1409");
  assert.equal(matchCallIn("one four zero nine dispatch"), "1409"); // connector dropped entirely
});

test("matchCallIn handles compound number words, not just single digits", () => {
  assert.equal(matchCallIn("fourteen oh nine to dispatch"), "1409");
  assert.equal(matchCallIn("twelve hundred to dispatch"), null); // "hundred" isn't a supported multiplier, expected miss
  assert.equal(matchCallIn("twenty two hundred to dispatch"), null); // same
  assert.equal(matchCallIn("fourteen to dispatch"), null); // only 2 digits, too short for a real callsign
});

test("matchCallIn on the exact real garbled transcript that prompted this fix", () => {
  // Real live transcript: STT heard "fourteen one i dispatch" for an attempted callsign
  // handshake — this is just about detecting a call-in ATTEMPT was made. The actual identity
  // used for addressing comes from resolveCallsign (real DB lookup), never from these digits.
  assert.equal(matchCallIn("fourteen one i dispatch"), "141");
});

test("matchCallIn also accepts 'traffic stop when ready' as a handshake suffix", () => {
  assert.equal(matchCallIn("2200 traffic stop when ready"), "2200");
  assert.equal(matchCallIn("two two zero zero traffic stop when ready"), "2200");
  assert.equal(matchCallIn("2200 traffic stop"), "2200");
});

test("idle state gives a spoken hint (not silence) when 'dispatch' is mentioned but the handshake doesn't parse", async () => {
  const session = createRadioSession();
  // "dispatch" appears mid-sentence, not as a leading cue word — this should NOT be treated as a
  // bare-cue-word handshake (that's covered by the dedicated test below).
  const action = await handleTransmission(
    session,
    "user-1",
    "can you hear me, this is dispatch calling",
    makeDeps({ matcher: alwaysUnrecognized }),
  );
  assert.equal(action.type, "say");
  assert.match((action as { text: string }).text, /callsign/i);
  assert.equal(session.activeSpeaker, null); // still idle — hint doesn't start a session
});

// Per request: don't make people speak digits at all if the system already knows their real
// callsign from who's actually talking — a bare cue word should be enough to call in.
test("bare cue word 'dispatch' with no digits at all is a valid handshake, using the resolved callsign", async () => {
  const session = createRadioSession();
  const action = await handleTransmission(session, "user-1409", "dispatch", makeDeps({ matcher: alwaysUnrecognized }));
  assert.deepEqual(action, { type: "say", text: "one four zero nine, go ahead." });
  assert.equal(session.activeSpeaker?.speakerId, "user-1409");
});

test("bare cue word 'central' also works as a handshake, not just 'dispatch'", async () => {
  const session = createRadioSession();
  const action = await handleTransmission(session, "user-1409", "central", makeDeps({ matcher: alwaysUnrecognized }));
  assert.deepEqual(action, { type: "say", text: "one four zero nine, go ahead." });
});

// The #1 real-world complaint: people say the handshake AND the command in one breath, not two
// separate turns. This should work end-to-end without a "go ahead" round-trip in between.
test("handshake and command spoken together in one utterance are both processed immediately", async () => {
  const session = createRadioSession();
  const action = await handleTransmission(
    session,
    "user-1409",
    "1500 to dispatch show me 10-8",
    makeDeps({ matcher: alwaysRecognized }),
  );
  assert.equal(action.type, "say");
  assert.match((action as { text: string }).text, /handled\./);
  // Exchange resolved in one shot (alwaysRecognized doesn't ask for follow-up) — back to idle.
  assert.equal(session.activeSpeaker, null);
});

test("ignores anything before a call-in handshake", async () => {
  const session = createRadioSession();
  const action = await handleTransmission(session, "user-1", "hey can someone help me", makeDeps());
  assert.deepEqual(action, { type: "ignore" });
  assert.equal(session.activeSpeaker, null);
});

test("go-ahead uses the speaker's REAL assigned callsign, not whatever digits were transcribed", async () => {
  const session = createRadioSession();
  // Speaker says a garbled/wrong-looking handshake, but resolveFromRoster knows who they REALLY
  // are from their Discord ID — that's what should be used to address them.
  const action = await handleTransmission(session, "user-1409", "fourteen one i dispatch", makeDeps());
  assert.deepEqual(action, { type: "say", text: "one four zero nine, go ahead." });
  assert.deepEqual(session.activeSpeaker, { speakerId: "user-1409", callsign: "1409" });
});

test("falls back to 'unassigned unit' when the speaker has no registered callsign", async () => {
  const session = createRadioSession();
  const action = await handleTransmission(session, "user-nobody", "1234 to dispatch", makeDeps());
  assert.deepEqual(action, { type: "say", text: "unassigned unit, go ahead." });
});

test("normal handshake flow: call-in -> go-ahead -> message -> 10-4 ack -> back to idle", async () => {
  const session = createRadioSession();
  const deps = makeDeps();

  const goAhead = await handleTransmission(session, "user-1409", "1409 to dispatch", deps);
  assert.deepEqual(goAhead, { type: "say", text: "one four zero nine, go ahead." });
  assert.deepEqual(session.activeSpeaker, { speakerId: "user-1409", callsign: "1409" });

  const ack = await handleTransmission(session, "user-1409", "requesting a plate check", deps);
  assert.deepEqual(ack, { type: "say", text: "10-4, I understand. handled." });
  assert.equal(session.activeSpeaker, null);
  assert.equal(session.holdQueue.length, 0);
});

test("a second unit keying up mid-exchange gets queued (please hold), then gets go-ahead after", async () => {
  const session = createRadioSession();
  const deps = makeDeps();

  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);

  const holdAction = await handleTransmission(session, "user-1378", "1378 to dispatch", deps);
  assert.deepEqual(holdAction, { type: "say", text: "one three seven eight, please hold." });
  assert.equal(session.activeSpeaker?.callsign, "1409"); // still 1409 active
  assert.equal(session.holdQueue.length, 1);

  const resolveAction = await handleTransmission(session, "user-1409", "status 10-8", deps);
  assert.deepEqual(resolveAction, {
    type: "say",
    text: "10-4, I understand. handled. one three seven eight, go ahead.",
  });
  assert.deepEqual(session.activeSpeaker, { speakerId: "user-1378", callsign: "1378" });
  assert.equal(session.holdQueue.length, 0);
});

test("chatter from a non-active, non-calling-in speaker is ignored, doesn't disrupt the active exchange", async () => {
  const session = createRadioSession();
  const deps = makeDeps();
  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);

  const action = await handleTransmission(session, "user-9999", "just chatting, not calling in", deps);
  assert.deepEqual(action, { type: "ignore" });
  assert.equal(session.activeSpeaker?.callsign, "1409");
});

test("unrecognized phrase (rules engine miss) triggers a 10-9 repeat request, keeps the same active speaker", async () => {
  const session = createRadioSession();
  const deps = makeDeps();
  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);

  const action = await handleTransmission(
    session,
    "user-1409",
    "some completely unmatched sentence",
    makeDeps({ matcher: alwaysUnrecognized }),
  );
  assert.deepEqual(action, { type: "say", text: "10-9, please repeat, one four zero nine." });
  assert.deepEqual(session.activeSpeaker, { speakerId: "user-1409", callsign: "1409" }); // still active, not dropped
});

test("low-confidence (garbled) transcript triggers a 10-9 repeat without even attempting to match intent", async () => {
  const session = createRadioSession();
  const deps = makeDeps();
  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);

  let matcherWasCalled = false;
  const trackingMatcher: IntentMatcher = () => {
    matcherWasCalled = true;
    return { kind: "recognized", responseText: "should not be reached" };
  };

  const action = await handleTransmission(
    session,
    "user-1409",
    "mumble mumble static",
    makeDeps({ matcher: trackingMatcher }),
    0.2,
  );
  assert.deepEqual(action, { type: "say", text: "10-9, please repeat, one four zero nine." });
  assert.equal(matcherWasCalled, false);
});

test("a recognized intent needing follow-up keeps the exchange open with the same speaker", async () => {
  const session = createRadioSession();
  const deps = makeDeps();
  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);

  const followUpMatcher: IntentMatcher = () => ({
    kind: "recognized",
    responseText: "what's the plate number?",
    needsFollowUp: true,
  });

  const action = await handleTransmission(session, "user-1409", "run a plate for me", makeDeps({ matcher: followUpMatcher }));
  assert.deepEqual(action, { type: "say", text: "10-4, I understand. what's the plate number?" });
  assert.deepEqual(session.activeSpeaker, { speakerId: "user-1409", callsign: "1409" }); // not dropped
});

test("a skipAck intent (e.g. attach-to-call) bypasses the '10-4, I understand' prefix", async () => {
  const session = createRadioSession();
  const deps = makeDeps();
  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);

  const attachMatcher: IntentMatcher = (_text, context) => ({
    kind: "recognized",
    responseText: `${context.spokenCallsign} is now enroute to postal five five five.`,
    skipAck: true,
  });

  const action = await handleTransmission(session, "user-1409", "attach to the robbery", makeDeps({ matcher: attachMatcher }));
  assert.deepEqual(action, {
    type: "say",
    text: "one four zero nine is now enroute to postal five five five.",
  });
});

test("matcher receives findActiveCall/attachUnitToCall from the injected deps, not a real database", async () => {
  const session = createRadioSession();
  const fixtureCall: ActiveCallInfo = { id: "call-1", postal: "555" };
  let attachedCallId: string | null = null;
  let attachedSpeakerId: string | null = null;

  const attachMatcher: IntentMatcher = async (text, context) => {
    const call = await context.findActiveCall(text);
    if (!call) return { kind: "unrecognized" };
    await context.attachUnitToCall(call.id, context.speakerId);
    return { kind: "recognized", responseText: "attached", skipAck: true };
  };

  const deps = makeDeps({
    matcher: attachMatcher,
    findActiveCall: async () => fixtureCall,
    attachUnitToCall: async (callId, speakerId) => {
      attachedCallId = callId;
      attachedSpeakerId = speakerId;
    },
  });

  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);
  const action = await handleTransmission(session, "user-1409", "attach to the robbery", deps);

  assert.deepEqual(action, { type: "say", text: "attached" });
  assert.equal(attachedCallId, "call-1");
  assert.equal(attachedSpeakerId, "user-1409");
});

// followUpTag / pendingFollowUpTag threading — the traffic-stop "additional units?" flow relies
// on this to route the NEXT utterance straight to a dedicated yes/no handler.
test("needsFollowUp with a followUpTag is stored on session state and handed back as pendingFollowUpTag next turn", async () => {
  const session = createRadioSession();

  let secondCallSawTag: string | null = null;
  let turnNumber = 0;
  const taggingMatcher: IntentMatcher = (_text, context) => {
    turnNumber += 1;
    if (turnNumber === 1) {
      return { kind: "recognized", responseText: "asking", needsFollowUp: true, followUpTag: "additional-units" };
    }
    secondCallSawTag = context.pendingFollowUpTag;
    return { kind: "recognized", responseText: "answered" };
  };

  const deps = makeDeps({ matcher: taggingMatcher });
  await handleTransmission(session, "user-1409", "1409 to dispatch", deps);
  await handleTransmission(session, "user-1409", "first message", deps);
  assert.equal(session.pendingFollowUpTag, "additional-units");

  await handleTransmission(session, "user-1409", "second message", deps);
  assert.equal(secondCallSawTag, "additional-units");
  assert.equal(session.pendingFollowUpTag, undefined); // cleared once the exchange resolves
});
