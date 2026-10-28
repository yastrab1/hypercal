import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TagCache } from "../server/tag-cache.mjs";
const event = {
  id: "one",
  calendarId: "primary",
  title: "Tagged event",
  tags: ["Exam"],
  source: "google",
  start: "2027-01-20T10:00:00Z",
  end: "2027-01-20T11:00:00Z",
  etag: "new",
};
test("tag cache survives process recreation, isolates accounts, and serves immediately before provider data arrives", () => {
  const root = mkdtempSync(join(tmpdir(), "hypercal-tag-cache-"));
  try {
    const cache = new TagCache(root, () => Date.parse("2026-10-29"));
    cache.remember("alice", [event], { local: true });
    const reopened = new TagCache(root, () => Date.parse("2026-10-29"));
    assert.equal(reopened.nearest("alice", "Exam", ["primary"]).id, "one");
    assert.equal(reopened.nearest("bob", "Exam", ["primary"]), null);
    assert.equal(reopened.nearest("alice", "Exam", ["other"]), null);
    assert.equal(statSync(reopened.file("alice")).mode & 0o777, 0o600);
    // A just-saved event must survive both an unindexed empty result and a stale list entry.
    assert.equal(
      reopened.range("alice", "primary", "2027-01-20", "2027-01-21", [])[0].id,
      "one",
    );
    reopened.remember("alice", [event]); // a fresh read can precede a stale index response
    assert.deepEqual(
      reopened.remember("alice", [{ ...event, tags: [], etag: "old" }])[0].tags,
      ["Exam"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("authoritative updates, removals and pending untag/delete tombstones invalidate cached countdowns", () => {
  const root = mkdtempSync(join(tmpdir(), "hypercal-tag-cache-"));
  let now = Date.parse("2026-10-29");
  try {
    const cache = new TagCache(root, () => now);
    cache.remember("alice", [event], { local: true });
    cache.remember("alice", [{ ...event, tags: [], etag: "untagged" }], {
      local: true,
    });
    assert.equal(cache.nearest("alice", "Exam", ["primary"]), null);
    cache.remember("alice", [event]); // stale listing cannot resurrect an untagged event
    assert.equal(cache.nearest("alice", "Exam", ["primary"]), null);
    now += 6 * 60_000;
    cache.remember("alice", [event]);
    assert.equal(cache.nearest("alice", "Exam", ["primary"]).id, "one");
    cache.remove("alice", "primary", "one");
    cache.remember("alice", [event]);
    assert.equal(cache.nearest("alice", "Exam", ["primary"]), null);
    now += 6 * 60_000;
    cache.remember("alice", [event]);
    cache.range("alice", "primary", "2027-01-20", "2027-01-21", []);
    assert.equal(cache.nearest("alice", "Exam", ["primary"]), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
