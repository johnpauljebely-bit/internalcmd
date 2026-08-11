import { test } from "node:test";
import assert from "node:assert/strict";
import { isSergeantOrAbove } from "./rankHierarchy.js";

test("RCMP — sergeant and above qualify", () => {
  assert.equal(isSergeantOrAbove("rcmp", "sergeant"), true);
  assert.equal(isSergeantOrAbove("rcmp", "inspector"), true);
  assert.equal(isSergeantOrAbove("rcmp", "superintendent"), true);
  assert.equal(isSergeantOrAbove("rcmp", "commissioner"), true);
});

test("RCMP — below sergeant does not qualify", () => {
  assert.equal(isSergeantOrAbove("rcmp", "constable"), false);
  assert.equal(isSergeantOrAbove("rcmp", "corporal"), false);
});

test("BCHP — sergeant and above qualify, including staff-sergeant/chief-superintendent", () => {
  assert.equal(isSergeantOrAbove("bchp", "sergeant"), true);
  assert.equal(isSergeantOrAbove("bchp", "staff-sergeant"), true);
  assert.equal(isSergeantOrAbove("bchp", "chief-superintendent"), true);
});

test("BCHP — below sergeant does not qualify", () => {
  assert.equal(isSergeantOrAbove("bchp", "constable"), false);
  assert.equal(isSergeantOrAbove("bchp", "corporal"), false);
});

test("unknown rank never qualifies", () => {
  assert.equal(isSergeantOrAbove("rcmp", "not-a-real-rank"), false);
});
