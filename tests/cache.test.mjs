import test from "node:test";
import assert from "node:assert/strict";
import { createCalendarCache } from "../src/cache.mjs";
function memory() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}
const alice = { id: "alice", email: "alice@example.test" },
  bob = { id: "bob", email: "bob@example.test" };
test("offline snapshots stay isolated by account and never include authentication tokens", () => {
  const storage = memory(),
    cache = createCalendarCache(storage);
  cache.writeMetadata(
    { ...alice, csrf: "secret", token: "secret" },
    [{ id: "a" }],
    [{ id: "school" }],
  );
  cache.writeRange(
    alice,
    "october",
    [{ id: "private" }],
    "2026-10-28T10:00:00Z",
  );
  cache.writeMetadata(bob, [{ id: "b" }], []);
  assert.equal(cache.readRange(bob.id, "october"), null);
  assert.equal(cache.readLast().user.id, "bob");
  assert.equal(
    cache.readAccount("alice").ranges.october.events[0].id,
    "private",
  );
  assert.deepEqual(cache.readAccount("alice").user, alice);
  assert(!storage.getItem("hypercal.cache.v1.alice").includes("secret"));
});
test("only six recent ranges remain, and expired snapshots are not shown", () => {
  let now = 100000000;
  const cache = createCalendarCache(memory(), () => now);
  cache.writeMetadata(alice, [], []);
  for (let i = 0; i < 9; i++) {
    now++;
    cache.writeRange(
      alice,
      String(i),
      [{ id: String(i) }],
      new Date(now).toISOString(),
    );
  }
  assert.equal(Object.keys(cache.readAccount("alice").ranges).length, 6);
  assert.equal(cache.readRange("alice", "0"), null);
  assert.equal(cache.readRange("alice", "8").events[0].id, "8");
  now += 15 * 86400000;
  assert.equal(cache.readLast(), null);
});
test("confirmed edits invalidate old event ranges and sign-out removes all private caches", () => {
  const storage = memory(),
    cache = createCalendarCache(storage);
  storage.setItem("hypercal.theme", "dark");
  cache.writeMetadata(alice, [], []);
  cache.writeRange(alice, "one", [{ id: "old" }], "now");
  cache.invalidateEvents("alice");
  assert.equal(cache.readRange("alice", "one"), null);
  assert.equal(cache.readAccount("alice").user.id, "alice");
  cache.writeMetadata(bob, [], []);
  cache.forget();
  assert.equal(cache.readLast(), null);
  assert.equal(cache.readAccount("alice"), null);
  assert.equal(cache.readAccount("bob"), null);
  assert.equal(storage.getItem("hypercal.theme"), "dark");
});
test("corrupt data and full storage never prevent online use", () => {
  const storage = memory();
  storage.setItem("hypercal.cache.v1.last", "not json");
  const cache = createCalendarCache(storage);
  assert.equal(cache.readLast(), null);
  const full = createCalendarCache({
    ...storage,
    setItem() {
      throw new Error("Quota exceeded");
    },
  });
  assert.doesNotThrow(() => full.writeMetadata(alice, [], []));
  assert.doesNotThrow(() => full.writeRange(alice, "month", [], "now"));
});
test("fresh metadata does not resurrect expired ranges on offline startup", () => {
  let now = 100000000;
  const storage = memory(),
    cache = createCalendarCache(storage, () => now);
  cache.writeMetadata(alice, [], []);
  cache.writeRange(alice, "old", [{ id: "stale" }], "old");
  now += 15 * 86400000;
  cache.writeMetadata(alice, [], []);
  assert.deepEqual(cache.readLast().ranges, {});
  storage.setItem(
    "hypercal.cache.v1.alice",
    JSON.stringify({ user: alice, updatedAt: now }),
  );
  assert.equal(cache.readLast(), null);
});
