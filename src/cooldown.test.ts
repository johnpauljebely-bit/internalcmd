import { test } from "node:test";
import assert from "node:assert/strict";
import { isOnCooldown } from "./cooldown.js";

test("no prior timestamp is never on cooldown", () => {
  assert.equal(isOnCooldown(undefined, Date.now(), 7000), false);
});

test("just-set timestamp is on cooldown", () => {
  const now = 1_000_000;
  assert.equal(isOnCooldown(now, now, 7000), true);
});

test("still on cooldown just before the window elapses", () => {
  const now = 1_000_000;
  assert.equal(isOnCooldown(now, now + 6999, 7000), true);
});

test("off cooldown exactly at the window boundary", () => {
  const now = 1_000_000;
  assert.equal(isOnCooldown(now, now + 7000, 7000), false);
});

test("off cooldown well after the window", () => {
  const now = 1_000_000;
  assert.equal(isOnCooldown(now, now + 60_000, 7000), false);
});
