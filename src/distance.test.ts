import { test } from "node:test";
import assert from "node:assert/strict";
import { distance2D } from "./distance.js";

test("distance2D is zero for identical points", () => {
  assert.equal(distance2D(10, 20, 10, 20), 0);
});

test("distance2D computes straight-line distance", () => {
  assert.equal(distance2D(0, 0, 3, 4), 5);
});
