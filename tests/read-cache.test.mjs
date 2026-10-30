import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadCache, createLimiter } from "../server/read-cache.mjs";

test("disk cache survives restart, canonicalizes ranges, isolates accounts and expires", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hypercal-cache-"));
  try {
    let time = 1000,
      calls = 0;
    const options = { now: () => time };
    const load = async () => [{ id: String(++calls) }];
    const first = new ReadCache(dir, options);
    const path =
      "calendars/test/events?timeMin=2026-10-01T00:00:00Z&singleEvents=true";
    assert.deepEqual(await first.read("alice", path, 100, load), [{ id: "1" }]);
    const restarted = new ReadCache(dir, options);
    const reordered =
      "calendars/test/events?singleEvents=true&timeMin=2026-10-01T00%3A00%3A00.000Z";
    assert.deepEqual(await restarted.read("alice", reordered, 100, load), [
      { id: "1" },
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(await restarted.read("bob", path, 100, load), [
      { id: "2" },
    ]);
    for (const name of await readdir(dir))
      assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    time += 101;
    assert.deepEqual(await restarted.read("alice", path, 100, load), [
      { id: "3" },
    ]);
    await restarted.invalidate("alice");
    assert.deepEqual(await restarted.read("alice", path, 100, load), [
      { id: "4" },
    ]);
    assert.deepEqual(await restarted.read("bob", path, 1000, load), [
      { id: "2" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an invalidation during a provider read prevents stale data reaching disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hypercal-cache-race-"));
  try {
    const cache = new ReadCache(dir);
    let finish, started;
    const ready = new Promise((r) => {
      started = r;
    });
    const pending = cache.read("alice", "calendars/test/events", 1000, () => {
      started();
      return new Promise((r) => {
        finish = r;
      });
    });
    await ready;
    await cache.invalidate("alice");
    finish([{ id: "old" }]);
    await pending;
    assert.deepEqual(await readdir(dir), []);
    assert.deepEqual(
      await cache.read("alice", "calendars/test/events", 1000, async () => [
        { id: "new" },
      ]),
      [{ id: "new" }],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corruption and failed provider reads do not become cached responses; storage stays bounded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hypercal-cache-bounds-"));
  try {
    const cache = new ReadCache(dir, { maxEntries: 2, maxBytes: 1000 });
    for (let i = 0; i < 4; i++)
      await cache.read("alice", `calendars/${i}/events`, 1000, async () => [i]);
    assert.equal((await readdir(dir)).length, 2);
    const name = (await readdir(dir))[0];
    await writeFile(join(dir, name), "broken");
    // Reading every key also exercises whichever entry was corrupted.
    for (let i = 0; i < 4; i++)
      assert.deepEqual(
        await cache.read("alice", `calendars/${i}/events`, 1000, async () => [
          i,
        ]),
        [i],
      );
    await assert.rejects(
      cache.read("alice", "failure", 1000, async () => {
        throw new Error("quota");
      }),
      /quota/,
    );
    assert.deepEqual(
      await cache.read("alice", "failure", 1000, async () => ["retry"]),
      ["retry"],
    );
    assert.ok((await readdir(dir)).length <= 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("provider limiter caps concurrent work and recovers from errors", async () => {
  const limit = createLimiter(4);
  let active = 0,
    peak = 0;
  const jobs = Array.from({ length: 20 }, (_, i) =>
    limit(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setImmediate(r));
      active--;
      if (i === 3) throw new Error("quota");
      return i;
    }),
  );
  const results = await Promise.allSettled(jobs);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
