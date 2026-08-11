import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPlayersByPartialUsername } from "./matchPlayer.js";
import type { ErlcPlayer } from "./erlcClient.js";

const players: ErlcPlayer[] = [
  { Player: "clearly_jp:111", Permission: "Normal" },
  { Player: "welovedallas:222", Permission: "Normal" },
  { Player: "maxendre9:333", Permission: "Normal" },
];

test("matches a full username, case-insensitive", () => {
  const result = matchPlayersByPartialUsername("CLEARLY_JP", players);
  assert.equal(result.length, 1);
  assert.equal(result[0].Player, "clearly_jp:111");
});

test("matches a partial substring", () => {
  const result = matchPlayersByPartialUsername("dallas", players);
  assert.equal(result.length, 1);
  assert.equal(result[0].Player, "welovedallas:222");
});

test("returns multiple matches for an ambiguous partial", () => {
  const result = matchPlayersByPartialUsername("e", players);
  assert.equal(result.length, 3); // all three usernames contain "e"
});

test("returns empty array for no match", () => {
  assert.deepEqual(matchPlayersByPartialUsername("zzz_nobody", players), []);
});
