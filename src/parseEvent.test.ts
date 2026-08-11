import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIncomingEvents } from "./parseEvent.js";

// Real captured payload from a live ;verify EGCMKR.
const REAL_CUSTOM_COMMAND = {
  events: [
    { data: { command: "verify", argument: "EGCMKR" }, timestamp: 1786330526, event: "CustomCommand", origin: "7822749012" },
  ],
  server: "fcRhxGplUzWaYtURGrIGUoCKXRDhrzdBRRveGScr",
};

// Real captured payload from ER:LC's periodic webhook validation probe.
const REAL_PROBE = {
  server: "global",
  events: [{ event: "WebhookProbe", timestamp: 1786330462, origin: "global", data: {} }],
};

test("parses a real captured CustomCommand event", () => {
  const [result] = parseIncomingEvents(REAL_CUSTOM_COMMAND);
  assert.deepEqual(result, {
    kind: "chat",
    robloxUserId: "7822749012",
    command: "verify",
    argument: "EGCMKR",
    raw: REAL_CUSTOM_COMMAND.events[0],
  });
});

test("parses a real captured WebhookProbe event", () => {
  const [result] = parseIncomingEvents(REAL_PROBE);
  assert.equal(result.kind, "probe");
});

test("handles a batch of multiple events in one POST", () => {
  const body = {
    events: [
      { event: "CustomCommand", origin: "111", data: { command: "ss", argument: "" } },
      { event: "CustomCommand", origin: "222", data: { command: "ts", argument: "" } },
    ],
    server: "x",
  };
  const results = parseIncomingEvents(body);
  assert.equal(results.length, 2);
  assert.equal(results[0].kind, "chat");
  assert.equal((results[0] as { command: string }).command, "ss");
  assert.equal((results[1] as { command: string }).command, "ts");
});

test("lowercases the command name", () => {
  const [result] = parseIncomingEvents({
    events: [{ event: "CustomCommand", origin: "1", data: { command: "VeRiFy", argument: "X" } }],
  });
  assert.equal((result as { command: string }).command, "verify");
});

test("defaults argument to empty string when absent", () => {
  const [result] = parseIncomingEvents({
    events: [{ event: "CustomCommand", origin: "1", data: { command: "ss" } }],
  });
  assert.equal((result as { argument: string }).argument, "");
});

test("classifies an unrecognized event type as unknown", () => {
  const [result] = parseIncomingEvents({ events: [{ event: "SomethingNew", origin: "1", data: {} }] });
  assert.equal(result.kind, "unknown");
});

test("handles bodies with no events array", () => {
  assert.equal(parseIncomingEvents({ foo: "bar" })[0].kind, "unknown");
  assert.equal(parseIncomingEvents(null)[0].kind, "unknown");
  assert.equal(parseIncomingEvents("string")[0].kind, "unknown");
});
