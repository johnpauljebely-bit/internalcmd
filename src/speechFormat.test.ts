import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCallsignForSpeech, formatPlateForSpeech, formatEmergencyCodesForSpeech } from "./speechFormat.js";

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

test("formatEmergencyCodesForSpeech converts 911 to digit-by-digit within a sentence", () => {
  assert.equal(
    formatEmergencyCodesForSpeech("Attention, 911 call coming from postal 111."),
    "Attention, nine one one call coming from postal 111.",
  );
});

test("formatEmergencyCodesForSpeech handles every real N11 code", () => {
  for (const code of ["211", "311", "411", "511", "611", "711", "811", "911"]) {
    const expected = code
      .split("")
      .map((d) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][Number(d)])
      .join(" ");
    assert.equal(formatEmergencyCodesForSpeech(`call ${code} now`), `call ${expected} now`);
  }
});

test("formatEmergencyCodesForSpeech leaves unrelated numbers alone (doesn't mangle quantities)", () => {
  assert.equal(formatEmergencyCodesForSpeech("3 units responding, 24 hour standby"), "3 units responding, 24 hour standby");
  assert.equal(formatEmergencyCodesForSpeech("postal 2671"), "postal 2671");
});

test("formatEmergencyCodesForSpeech doesn't match X11 as part of a longer number", () => {
  assert.equal(formatEmergencyCodesForSpeech("case 9110"), "case 9110");
  assert.equal(formatEmergencyCodesForSpeech("case 19110"), "case 19110");
});
