import { test } from "node:test";
import assert from "node:assert/strict";
import { findLowestAvailableNumber } from "./callsignAssign.js";

test("returns the range minimum when nothing is taken", () => {
  assert.equal(findLowestAvailableNumber(1400, 1499, new Set()), 1400);
});

test("skips taken numbers in order", () => {
  assert.equal(findLowestAvailableNumber(1400, 1499, new Set([1400, 1401, 1403])), 1402);
});

test("returns null when the whole range is taken", () => {
  const taken = new Set<number>();
  for (let n = 1400; n <= 1499; n++) taken.add(n);
  assert.equal(findLowestAvailableNumber(1400, 1499, taken), null);
});

test("single-number range works", () => {
  assert.equal(findLowestAvailableNumber(2050, 2050, new Set()), 2050);
  assert.equal(findLowestAvailableNumber(2050, 2050, new Set([2050])), null);
});
