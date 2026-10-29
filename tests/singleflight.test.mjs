import test from "node:test";
import assert from "node:assert/strict";
import { createSingleFlight } from "../server/singleflight.mjs";
test("concurrent reads share one request while accounts and ranges stay isolated", async () => {
  const read = createSingleFlight();
  let calls = 0;
  let resolve;
  const loader = () => {
    calls++;
    return new Promise((r) => (resolve = r));
  };
  const a = read(JSON.stringify(["alice", "calendars"]), loader),
    b = read(JSON.stringify(["alice", "calendars"]), loader);
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(
    await read(JSON.stringify(["bob", "calendars"]), () => ["bob"]),
    ["bob"],
  );
  assert.deepEqual(
    await read(JSON.stringify(["alice", "other-range"]), () => ["other"]),
    ["other"],
  );
  resolve(["alice"]);
  assert.deepEqual(await a, ["alice"]);
  assert.deepEqual(await b, ["alice"]);
  assert.deepEqual(
    await read(JSON.stringify(["alice", "calendars"]), () => ["fresh"]),
    ["fresh"],
  );
});
test("failed reads are evicted and can be retried", async () => {
  const read = createSingleFlight();
  const failed = () => {
    throw new Error("Provider unavailable");
  };
  const a = read("key", failed),
    b = read("key", failed);
  await assert.rejects(a, /Provider unavailable/);
  await assert.rejects(b, /Provider unavailable/);
  assert.equal(await read("key", () => 42), 42);
});

test("a mutation can invalidate an older read without its cleanup removing the fresh read", async () => {
  const read = createSingleFlight();
  let finishOld, finishNew;
  const old = read(
    "alice",
    () => new Promise((resolve) => (finishOld = resolve)),
  );
  await Promise.resolve();
  read.invalidate((key) => key === "alice");
  const fresh = read(
    "alice",
    () => new Promise((resolve) => (finishNew = resolve)),
  );
  await Promise.resolve();
  assert.notEqual(fresh, old);
  finishOld("old");
  assert.equal(await old, "old");
  assert.equal(
    read("alice", () => {
      throw new Error("must join fresh read");
    }),
    fresh,
  );
  finishNew("new");
  assert.equal(await fresh, "new");
});
