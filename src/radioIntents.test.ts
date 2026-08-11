import { test } from "node:test";
import assert from "node:assert/strict";
import { matchIntent } from "./radioIntents.js";
import type { IntentContext, ActiveCallInfo, ActiveTrafficStopInfo, NearestUnitDispatchResult } from "./radioSession.js";

function makeContext(overrides: Partial<IntentContext> = {}): IntentContext {
  return {
    speakerId: "user-1409",
    spokenCallsign: "one four zero nine",
    pendingFollowUpTag: null,
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

test("recognizes a 10-code definition query", async () => {
  const result = await matchIntent("what's 10-4", makeContext());
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /Acknowledged/);
});

test("recognizes a 10-code definition query without the dash", async () => {
  const result = await matchIntent("what is 108", makeContext());
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /In service/);
});

test("handles an unknown 10-code gracefully instead of crashing", async () => {
  const result = await matchIntent("what's 10-101", makeContext());
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /don't have a definition/);
});

test("full 10-code list covers 10-0 through 10-100 as specified", async () => {
  const spotChecks: Record<string, RegExp> = {
    "10-0": /use caution/i,
    "10-13": /shots fired/i,
    "10-32": /person with a gun/i,
    "10-55": /intoxicated driver/i,
    "10-78": /need assistance/i,
    "10-99": /officer in danger/i,
    "10-100": /restroom break/i,
  };
  for (const [code, expected] of Object.entries(spotChecks)) {
    const result = await matchIntent(`what's ${code}`, makeContext());
    assert.match(result.responseText ?? "", expected, `expected ${code} to match ${expected}`);
  }
});

// 2026-08-11: status updates now persist into the CAD's live_units.status (the 5-state model —
// available/unavailable/busy/enroute/on_scene) rather than just speaking a "logged" phrase that
// goes nowhere. "status 10-8" maps 10-8 -> "available" and the response is a plain ack (wrapped in
// the usual "10-4, I understand" prefix by the caller), not an explanation of what 10-8 means.
test("recognizes a status update with a 10-code, persists it as the CAD's 5-state status", async () => {
  let recordedStatus: string | null = null;
  const result = await matchIntent(
    "status 10-8",
    makeContext({ updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; } }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(recordedStatus, "available");
  assert.equal(result.responseText, "one four zero nine.");
});

test("recognizes a status update with a plain word, persists it as the CAD's 5-state status", async () => {
  let recordedStatus: string | null = null;
  const result = await matchIntent(
    "status en route",
    makeContext({ updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; } }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(recordedStatus, "enroute");
});

test("recognizes a plate check and reports nothing on file (no BOLO store yet), spoken with NATO phonetics", async () => {
  const result = await matchIntent("run plate ABC123", makeContext());
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /Alpha Bravo Charlie one two three/);
  assert.match(result.responseText ?? "", /nothing on file/);
});

test("unrecognized free-form speech falls through to unrecognized", async () => {
  const result = await matchIntent("hey what's the weather like out there today", makeContext());
  assert.equal(result.kind, "unrecognized");
});

// These verify the matcher extracts the most likely intent despite filler words around the key
// signal, instead of only accepting one exact phrasing.
test("tolerates filler words around a plate check", async () => {
  const result = await matchIntent("uh can you run a check on plate ABC123 for me", makeContext());
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /Alpha Bravo Charlie one two three/);
});

test("tolerates filler words around a status update", async () => {
  let recordedStatus: string | null = null;
  const result = await matchIntent(
    "dispatch this is unit whatever, my status update is en route to the scene",
    makeContext({ updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; } }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(recordedStatus, "enroute");
});

test("asks for the plate number instead of giving up when 'plate' is said with nothing usable after it", async () => {
  const result = await matchIntent("can you check a plate for me", makeContext());
  assert.equal(result.kind, "recognized");
  assert.equal(result.needsFollowUp, true);
  assert.match(result.responseText ?? "", /plate number/i);
});

test("asks for status instead of giving up when 'status' is said with nothing extractable", async () => {
  const result = await matchIntent("status", makeContext());
  assert.equal(result.kind, "recognized");
  assert.equal(result.needsFollowUp, true);
});

test("status update takes priority over a 10-code query when both signals are present", async () => {
  // "status 10-8" should log/persist a status, not explain what 10-8 means — no "what/mean"
  // present here.
  let recordedStatus: string | null = null;
  const result = await matchIntent(
    "status 10-8",
    makeContext({ updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; } }),
  );
  assert.equal(recordedStatus, "available");
  assert.equal(result.kind, "recognized");
});

// Confirmed live (real server log): Vosk transcribes spoken codes as WORDS ("ten eight"), not
// digit characters. Also confirmed live: "show me 10-8" is a status REPORT ("I am now 10-8"), not
// a request to explain what 10-8 means — real radio convention, "show me X" is dispatch slang for
// "log me as X," same as the CAD's own "show" trigger word choice originally intended (that
// wiring was fixed here to actually persist status rather than explain the code back).
test("recognizes a 10-code status report spoken as words, not literal digits (real transcript: 'show me ten eight one zero five zero')", async () => {
  let recordedStatus: string | null = null;
  const result = await matchIntent(
    "show me ten eight one zero five zero",
    makeContext({ updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; } }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(recordedStatus, "available");
});

test("recognizes a 10-code status report with a spoken 'dash' between the words (real transcript: 'one zero five zero show me ten dash eight')", async () => {
  let recordedStatus: string | null = null;
  const result = await matchIntent(
    "one zero five zero show me ten dash eight",
    makeContext({ updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; } }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(recordedStatus, "available");
});

test("recognizes a status update with a spoken-word 10-code, not just literal digits", async () => {
  let recordedStatus: string | null = null;
  const result = await matchIntent(
    "status ten eight",
    makeContext({ updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; } }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(recordedStatus, "available");
});

// "show me enroute to the call at postal X" — a status report AND a call attachment in one
// utterance, per the exact scenario requested: dispatch attaches the unit to that call and marks
// them enroute, rather than requiring two separate transmissions.
test("status update combined with a call attachment by postal — attaches AND persists enroute", async () => {
  const call: ActiveCallInfo = { id: "call-30", postal: "910" };
  let attachedCallId: string | null = null;
  let recordedStatus: string | null = null;
  let recordedCallId: string | null | undefined;

  const result = await matchIntent(
    "show me enroute to the call at postal 910",
    makeContext({
      findActiveCallByPostal: async (postal) => (postal === "910" ? call : null),
      attachUnitToCall: async (callId) => { attachedCallId = callId; },
      updateUnitStatus: async (_speakerId, status, callId) => {
        recordedStatus = status;
        recordedCallId = callId;
      },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(result.skipAck, true);
  assert.equal(attachedCallId, "call-30");
  assert.equal(recordedStatus, "enroute");
  assert.equal(recordedCallId, "call-30");
  assert.match(result.responseText ?? "", /enroute, postal nine one zero, case number call-30/);
});

// The user's own example phrasings for this exact scenario (BOT_SIDE_INSTRUCTIONS.md #9,
// verbatim), none of which are worded identically — deliberately testing all three so the
// matcher can't quietly only handle the first one.
for (const phrasing of [
  "1500 to dispatch show me enroute to the call at postal 2171",
  "1500 show me en route to postal 2171", // no literal "call" word at all
  "dispatch 1500 en route to that call at 2171", // no "postal" word, no "status"/"show" signal word
]) {
  test(`handles real phrasing variation: "${phrasing}"`, async () => {
    const call: ActiveCallInfo = { id: "call-88", postal: "2171" };
    let attachedCallId: string | null = null;
    let recordedStatus: string | null = null;

    const result = await matchIntent(
      phrasing,
      makeContext({
        findActiveCallByPostal: async (postal) => (postal === "2171" ? call : null),
        attachUnitToCall: async (callId) => { attachedCallId = callId; },
        updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; },
      }),
    );

    assert.equal(result.kind, "recognized");
    assert.equal(attachedCallId, "call-88", `expected an attach for: "${phrasing}"`);
    assert.equal(recordedStatus, "enroute", `expected status=enroute for: "${phrasing}"`);
  });
}

// Per the explicit spec: this scenario's phrasing presumes an EXISTING call ("the call at postal
// X") — report absence rather than fabricating one, unlike matchAttachToCall's "attach me to the
// panic" phrasing (which self-declares, since that scenario is explicitly about reporting
// something new dispatch has no record of).
test("status+postal reports absence instead of self-declaring when nothing's on file there", async () => {
  let declareCalled = false;
  let recordedStatus: string | null = null;

  const result = await matchIntent(
    "show me enroute to the call at postal 999",
    makeContext({
      findActiveCallByPostal: async () => null,
      declareCall: async () => { declareCalled = true; return { id: "should-not-happen", postal: null }; },
      updateUnitStatus: async (_speakerId, status) => { recordedStatus = status; },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(declareCalled, false);
  assert.equal(recordedStatus, "enroute");
  assert.match(result.responseText ?? "", /don't have a call at postal nine nine nine/);
});

test("status update without a postal/call mention doesn't touch call_id", async () => {
  let callIdArg: string | null | undefined = "not-called";
  const result = await matchIntent(
    "show me busy",
    makeContext({
      updateUnitStatus: async (_speakerId, _status, callId) => { callIdArg = callId; },
    }),
  );
  assert.equal(result.kind, "recognized");
  // undefined means "leave call_id untouched" — distinct from null ("clear it"), verified here
  // since "busy" isn't "available" and no call was mentioned in this utterance.
  assert.equal(callIdArg, undefined);
});

test("going 'available' clears call_id even with no postal mentioned", async () => {
  let callIdArg: string | null | undefined = "not-called";
  const result = await matchIntent(
    "show me 10-8",
    makeContext({
      updateUnitStatus: async (_speakerId, _status, callId) => { callIdArg = callId; },
    }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(callIdArg, null);
});

// Compound two-digit codes (10-28, 10-32) are commonly read as one compound word ("twenty eight"),
// which normalizeSpokenDigits alone leaves as two separate tokens ("20" "8") — this needs merging
// back into "28", not just word-to-digit substitution.
test("recognizes a 10-code query with a compound spoken number ('ten twenty eight' -> 10-28)", async () => {
  const result = await matchIntent("what's ten twenty eight", makeContext());
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /Vehicle registration check/);
});

test("does NOT merge digit-by-digit 10-code reading into the wrong code ('ten eight' stays 10-8, not merged)", async () => {
  const result = await matchIntent("what's ten eight", makeContext());
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /In service/);
});

test("10-11 traffic stop trigger recognizes the spoken-word form, not just literal digits", async () => {
  let started = false;
  const result = await matchIntent(
    "i'll be on a ten eleven postal 910 highway 55 with a red sedan",
    makeContext({ startTrafficStop: async () => { started = true; return "stop-1"; } }),
  );
  assert.equal(result.kind, "recognized");
  assert.ok(started, "expected a traffic stop to have been opened");
});

test("plate-check '28' trigger recognizes the compound spoken form ('twenty eight') during an active stop", async () => {
  const activeStop: ActiveTrafficStopInfo = { id: "stop-1", postal: "910", vehicleDescription: "sedan" };
  const result = await matchIntent(
    "twenty eight reading abc123",
    makeContext({ getActiveTrafficStop: async () => activeStop }),
  );
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /Alpha Bravo Charlie one two three/);
});

test("additional-units 'thirty two' (spoken '32') is recognized as a request for backup, not just literal digits", async () => {
  const result = await matchIntent(
    "thirty two",
    makeContext({
      pendingFollowUpTag: "additional-units",
      getActiveTrafficStop: async () => ({ id: "stop-1", postal: "910", vehicleDescription: "sedan" }),
      dispatchNearestUnitToTrafficStop: async () => ({ label: "one three seven eight", postal: "911" }),
    }),
  );
  assert.equal(result.kind, "recognized");
  assert.match(result.responseText ?? "", /one three seven eight/);
});

// "attach to call" — officers self-assign to an active call by describing it.
test("attach-to-call matches an active call by description and records the assignment", async () => {
  const call: ActiveCallInfo = { id: "call-42", postal: "555" };
  let attachedCallId: string | null = null;
  let attachedSpeaker: string | null = null;

  const result = await matchIntent(
    "1409 attach to the robbery",
    makeContext({
      findActiveCall: async (query) => (query.includes("robbery") ? call : null),
      attachUnitToCall: async (callId, speakerId) => {
        attachedCallId = callId;
        attachedSpeaker = speakerId;
      },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(result.skipAck, true);
  assert.equal(
    result.responseText,
    "one four zero nine is now enroute to postal five five five, case number call-42.",
  );
  assert.equal(attachedCallId, "call-42");
  assert.equal(attachedSpeaker, "user-1409");
});

test("attach-to-call reports no match instead of silently failing when nothing matches", async () => {
  const result = await matchIntent("attach to the robbery", makeContext({ findActiveCall: async () => null }));
  assert.equal(result.kind, "recognized");
  assert.equal(result.skipAck, true);
  assert.match(result.responseText ?? "", /no active call matching/i);
});

// "1050 to dispatch attach me to case #4521" — exact case-number attach, distinct from the fuzzy
// description match above. Case number lookup takes priority whenever "case" is spoken.
test("attach-to-call matches an active call by exact spoken case number (literal digits)", async () => {
  const call: ActiveCallInfo = { id: "4521", postal: "910" };
  let lookedUpCaseNumber: string | null = null;
  let attachedCallId: string | null = null;

  const result = await matchIntent(
    "attach me to case number 4521",
    makeContext({
      findActiveCallByCaseNumber: async (caseNumber) => {
        lookedUpCaseNumber = caseNumber;
        return caseNumber === "4521" ? call : null;
      },
      attachUnitToCall: async (callId) => {
        attachedCallId = callId;
      },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(result.skipAck, true);
  assert.equal(lookedUpCaseNumber, "4521");
  assert.equal(attachedCallId, "4521");
  assert.equal(
    result.responseText,
    "one four zero nine is now enroute to postal nine one zero, case number four five two one.",
  );
});

test("attach-to-call matches a case number spoken as digit words, not just literal digits", async () => {
  const call: ActiveCallInfo = { id: "4521", postal: "910" };
  let lookedUpCaseNumber: string | null = null;

  const result = await matchIntent(
    "attach to case number four five two one",
    makeContext({
      findActiveCallByCaseNumber: async (caseNumber) => {
        lookedUpCaseNumber = caseNumber;
        return caseNumber === "4521" ? call : null;
      },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(lookedUpCaseNumber, "4521");
});

test("attach-to-call with a case number that matches nothing reports no match, not a fuzzy fallback", async () => {
  const result = await matchIntent(
    "attach me to case #9999",
    makeContext({
      findActiveCallByCaseNumber: async () => null,
      findActiveCall: async () => ({ id: "should-not-be-used", postal: "1" }),
    }),
  );
  assert.equal(result.kind, "recognized");
  assert.equal(result.skipAck, true);
  assert.match(result.responseText ?? "", /no active call matching/i);
});

// "attach to X at postal Y" — a third way to identify the call, and one that also self-declares a
// brand new call when dispatch has nothing on file at that postal (real scenario: "100 to dispatch
// attach me to the panic at postal X" when no ER:LC panic event was ever received — panic events
// have never even been confirmed to exist as a webhook event, see NEEDS_HUMAN_VERIFICATION.md).
test("attach-to-call finds an existing call by postal and attaches, sets status enroute", async () => {
  const call: ActiveCallInfo = { id: "call-77", postal: "910" };
  let attachedCallId: string | null = null;
  let recordedStatus: string | null = null;
  let recordedCallId: string | null | undefined;
  let declareCalled = false;

  const result = await matchIntent(
    "attach me to the robbery at postal 910",
    makeContext({
      findActiveCallByPostal: async (postal) => (postal === "910" ? call : null),
      declareCall: async () => { declareCalled = true; return { id: "should-not-be-used", postal: null }; },
      attachUnitToCall: async (callId) => { attachedCallId = callId; },
      updateUnitStatus: async (_speakerId, status, callId) => {
        recordedStatus = status;
        recordedCallId = callId;
      },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(declareCalled, false, "should not self-declare when a real call already exists at that postal");
  assert.equal(attachedCallId, "call-77");
  assert.equal(recordedStatus, "enroute");
  assert.equal(recordedCallId, "call-77");
  assert.match(result.responseText ?? "", /enroute to postal nine one zero, case number call-77/);
});

test("attach-to-call self-declares a new call when nothing's on file at that postal (e.g. an unconfirmed panic)", async () => {
  let declaredDescription: string | null = null;
  let declaredPostal: string | null = null;
  let declaredBySpeaker: string | null = null;
  let attachedCallId: string | null = null;

  const result = await matchIntent(
    "attach me to the panic at postal 725",
    makeContext({
      findActiveCallByPostal: async () => null,
      declareCall: async (speakerId, description, postal) => {
        declaredBySpeaker = speakerId;
        declaredDescription = description;
        declaredPostal = postal;
        return { id: "9012", postal };
      },
      attachUnitToCall: async (callId) => { attachedCallId = callId; },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(declaredBySpeaker, "user-1409");
  assert.equal(declaredPostal, "725");
  assert.match(declaredDescription ?? "", /panic/);
  assert.equal(attachedCallId, "9012");
  assert.match(result.responseText ?? "", /enroute to postal seven two five, case number nine zero one two/);
});

// Traffic stop workflow: "10-11 postal X ... with a [vehicle]. 28 when ready" -> plate readout
// ("28 reading X") -> "do you need additional units?" -> yes/no -> nearest-unit dispatch.
test("10-11 report extracts postal + vehicle description and opens a traffic stop", async () => {
  let recordedPostal: string | null = null;
  let recordedVehicle: string | null = null;

  const result = await matchIntent(
    "i'll be on a 10-11 postal 910 highway 55 with a red 4-door sedan. 28 when ready",
    makeContext({
      startTrafficStop: async (_speakerId, postal, vehicle) => {
        recordedPostal = postal;
        recordedVehicle = vehicle;
        return "stop-1";
      },
    }),
  );

  assert.equal(recordedPostal, "910");
  assert.match(recordedVehicle ?? "", /red 4-door sedan/);
  assert.equal(result.kind, "recognized");
  assert.equal(result.needsFollowUp, true);
  assert.match(result.responseText ?? "", /28, go ahead/i);
});

test("10-11 report without a plate flag just logs, no follow-up expected", async () => {
  const result = await matchIntent(
    "i'll be on a 10-11 postal 200 main street with a blue pickup truck.",
    makeContext(),
  );
  assert.equal(result.kind, "recognized");
  assert.ok(!result.needsFollowUp);
});

test("plate check during an active traffic stop asks about additional units and records the plate", async () => {
  const stop: ActiveTrafficStopInfo = { id: "stop-1", postal: "910", vehicleDescription: "red sedan" };
  let recordedPlate: string | null = null;

  const result = await matchIntent(
    "28 reading ABC123",
    makeContext({
      getActiveTrafficStop: async () => stop,
      recordTrafficStopPlate: async (stopId, plate) => {
        assert.equal(stopId, "stop-1");
        recordedPlate = plate;
      },
    }),
  );

  assert.equal(recordedPlate, "ABC123");
  assert.equal(result.kind, "recognized");
  assert.equal(result.followUpTag, "additional-units");
  assert.match(result.responseText ?? "", /Alpha Bravo Charlie one two three/);
  assert.match(result.responseText ?? "", /additional units/i);
});

test("bare '28' without an active traffic stop is not treated as a plate check (too ambiguous with the 10-code itself)", async () => {
  const result = await matchIntent("28 reading ABC123", makeContext({ getActiveTrafficStop: async () => null }));
  assert.equal(result.kind, "unrecognized");
});

test("additional-units follow-up: 'yes' dispatches the nearest unit and constructs the announcement", async () => {
  const stop: ActiveTrafficStopInfo = { id: "stop-1", postal: "910", vehicleDescription: "red sedan" };
  const nearest: NearestUnitDispatchResult = { label: "one three seven eight", postal: "912" };

  const result = await matchIntent(
    "yes please",
    makeContext({
      pendingFollowUpTag: "additional-units",
      getActiveTrafficStop: async () => stop,
      dispatchNearestUnitToTrafficStop: async (stopId, speakerId) => {
        assert.equal(stopId, "stop-1");
        assert.equal(speakerId, "user-1409");
        return nearest;
      },
    }),
  );

  assert.equal(result.kind, "recognized");
  assert.equal(result.skipAck, true);
  assert.match(result.responseText ?? "", /one three seven eight, attach and enroute to postal nine one two/);
  assert.match(result.responseText ?? "", /one four zero nine/); // the requesting officer's own callsign
});

test("additional-units follow-up: 'no' declines without dispatching anyone", async () => {
  let dispatchCalled = false;
  const result = await matchIntent(
    "no i'm good",
    makeContext({
      pendingFollowUpTag: "additional-units",
      dispatchNearestUnitToTrafficStop: async () => {
        dispatchCalled = true;
        return null;
      },
    }),
  );
  assert.equal(dispatchCalled, false);
  assert.match(result.responseText ?? "", /solo on scene/i);
});

test("additional-units follow-up: ambiguous answer asks again instead of guessing", async () => {
  const result = await matchIntent(
    "uh maybe",
    makeContext({ pendingFollowUpTag: "additional-units" }),
  );
  assert.equal(result.needsFollowUp, true);
  assert.equal(result.followUpTag, "additional-units");
});

test("additional-units follow-up: no other units available reports that instead of crashing", async () => {
  const result = await matchIntent(
    "32",
    makeContext({
      pendingFollowUpTag: "additional-units",
      getActiveTrafficStop: async () => ({ id: "stop-1", postal: "910", vehicleDescription: "red sedan" }),
      dispatchNearestUnitToTrafficStop: async () => null,
    }),
  );
  assert.match(result.responseText ?? "", /no other units available/i);
});

test("pendingFollowUpTag routes to the additional-units handler before the normal matcher order", async () => {
  // Even though this text would normally hit matchStatusUpdate/plate/etc, the pending tag takes
  // priority since dispatch is expecting a yes/no answer right now.
  let dispatchCalled = false;
  const result = await matchIntent(
    "negative",
    makeContext({
      pendingFollowUpTag: "additional-units",
      dispatchNearestUnitToTrafficStop: async () => {
        dispatchCalled = true;
        return null;
      },
    }),
  );
  assert.equal(dispatchCalled, false);
  assert.match(result.responseText ?? "", /solo on scene/i);
});
