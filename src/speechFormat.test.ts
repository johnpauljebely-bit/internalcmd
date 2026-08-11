import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCallsignForSpeech, formatPlateForSpeech } from "./speechFormat.js";

test("formats a 4-digit callsign digit by digit", () => {
  assert.equal(formatCallsignForSpeech("1409"), "one four zero nine");
});

test("formats a 3-digit callsign digit by digit", () => {
  assert.equal(formatCallsignForSpeech("442"), "four four two");
});

test("handles a callsign with no zeros", () => {
  assert.equal(formatCallsignForSpeech("1247"), "one two four seven");
});

test("formats a plate with the NATO phonetic alphabet", () => {
  assert.equal(formatPlateForSpeech("ABC123"), "Alpha Bravo Charlie one two three");
});

test("formatPlateForSpeech is case-insensitive", () => {
  assert.equal(formatPlateForSpeech("abc123"), "Alpha Bravo Charlie one two three");
});

test("formatPlateForSpeech drops separators like dashes and spaces", () => {
  assert.equal(formatPlateForSpeech("AB-123"), "Alpha Bravo one two three");
  assert.equal(formatPlateForSpeech("AB 123"), "Alpha Bravo one two three");
});

test("formatPlateForSpeech covers every letter of the alphabet correctly", () => {
  assert.equal(
    formatPlateForSpeech("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    "Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu",
  );
});
