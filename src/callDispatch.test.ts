import { test } from "node:test";
import assert from "node:assert/strict";
import { extractXZ } from "./callDispatch.js";

test("extractXZ handles a lowercase x/z object", () => {
  assert.deepEqual(extractXZ({ x: 10, z: 20 }), { x: 10, z: 20 });
});

test("extractXZ handles an uppercase X/Z object", () => {
  assert.deepEqual(extractXZ({ X: 10, Z: 20 }), { x: 10, z: 20 });
});

test("extractXZ handles a LocationX/LocationZ object", () => {
  assert.deepEqual(extractXZ({ LocationX: 10, LocationZ: 20 }), { x: 10, z: 20 });
});

test("extractXZ handles a 3-part comma string, dropping the middle value", () => {
  assert.deepEqual(extractXZ("10, 5, 20"), { x: 10, z: 20 });
});

test("extractXZ handles a 2-part comma string", () => {
  assert.deepEqual(extractXZ("10, 20"), { x: 10, z: 20 });
});

test("extractXZ returns null for unrecognized shapes", () => {
  assert.equal(extractXZ(null), null);
  assert.equal(extractXZ(undefined), null);
  assert.equal(extractXZ(42), null);
  assert.equal(extractXZ({ foo: "bar" }), null);
  assert.equal(extractXZ("not, a, number, list"), null);
});
