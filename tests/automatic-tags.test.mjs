import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("automatic tagging persists countdowns, writes recurring masters once, handles exceptions, preserves metadata and never writes read-only sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "hypercal-auto-tags-"));
  process.env.DATA_DIR = root;
  const { upsertAccount, getAccount } = await import("../server/store.mjs");
  const { TagCache } = await import("../server/tag-cache.mjs");
  const { createAutomaticTags } = await import("../server/automatic-tags.mjs");
  const { readEventTags } = await import("../server/tags.mjs");
  const cache = new TagCache(join(root, "tags"));
  const rule = {
    mode: "automatic",
    calendarIds: [],
    include: "exam",
    exclude: "practice",
  };
  upsertAccount("alice", {
    tags: [{ name: "Exam", rule }],
    views: [],
    subscriptions: [],
  });
  upsertAccount("bob", { tags: [], views: [], subscriptions: [] });
  const calendar = { id: "school", accessRole: "owner" };
  const base = {
    summary: "Exam",
    etag: "v1",
    start: { date: "2027-02-01" },
    end: { date: "2027-02-02" },
    extendedProperties: {
      private: { keep: "private" },
      shared: { keep: "shared" },
    },
  };
  const master = {
    ...structuredClone(base),
    id: "master",
    recurrence: ["RRULE:FREQ=WEEKLY"],
  };
  const occurrence = {
    ...structuredClone(base),
    id: "master_1",
    recurringEventId: "master",
  };
  const occurrence2 = {
    ...structuredClone(base),
    id: "master_2",
    recurringEventId: "master",
  };
  const exception = {
    ...structuredClone(base),
    id: "master_exception",
    recurringEventId: "master",
    summary: "Practice exam",
    extendedProperties: {
      shared: { hypercalTags: '["Exam","Manual"]' },
      private: { keep: "private" },
    },
  };
  const records = new Map(
    [master, occurrence, occurrence2, exception].map((e) => [e.id, e]),
  );
  const writes = [];
  let conflict = false;
  const request = async (owner, path, options = {}) => {
    assert.equal(owner, "alice");
    const id = decodeURIComponent(path.split("/").at(-1));
    const source = records.get(id);
    assert(source);
    if (options.method === "PATCH") {
      if (conflict)
        throw Object.assign(new Error("Changed elsewhere"), { status: 412 });
      assert.equal(options.etag, source.etag);
      assert.equal(options.body.extendedProperties.private.keep, "private");
      writes.push(id);
      source.extendedProperties = options.body.extendedProperties;
      source.etag += "x";
      if (id === "master")
        for (const child of [occurrence, occurrence2]) {
          child.extendedProperties = structuredClone(source.extendedProperties);
          child.etag = source.etag;
        }
    }
    return structuredClone(source);
  };
  const service = createAutomaticTags(cache, {
    request,
    list: async (id, path) =>
      path.startsWith("users/")
        ? [calendar]
        : [...records.values()].filter((e) => !e.recurrence),
  });
  const wait = async (predicate) => {
    for (let i = 0; i < 700; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("Automatic sync timed out");
  };
  try {
    service.enqueue("alice", calendar, [
      occurrence,
      occurrence,
      occurrence2,
      exception,
    ]);
    service.enqueue("alice", { id: "readonly", accessRole: "reader" }, [
      { ...base, id: "readonly-event" },
    ]);
    service.enqueue("bob", calendar, [occurrence]);
    await wait(
      () => writes.length === 2 && service.status("alice").pending === 0,
    );
    assert.deepEqual(writes.sort(), ["master", "master_exception"]);
    assert.deepEqual(readEventTags(master), ["Exam"]);
    assert.equal(master.extendedProperties.shared.keep, "shared");
    assert.deepEqual(readEventTags(exception), ["Manual"]);
    assert.deepEqual(service.status("bob"), {
      pending: 0,
      scanning: false,
      error: null,
    });
    const reopened = new TagCache(join(root, "tags"));
    assert(
      reopened
        .events("alice")
        .some((e) => e.calendarId === "readonly" && e.tags.includes("Exam")),
    );
    assert(
      reopened
        .events("alice")
        .some((e) => e.id === "master_1" && e.tags.includes("Exam")),
    );
    upsertAccount("alice", {
      tags: [{ name: "Exam", rule: { ...rule, calendarIds: ["elsewhere"] } }],
    });
    service.changed("alice");
    await wait(
      () =>
        writes.length === 3 &&
        !service.status("alice").scanning &&
        service.status("alice").pending === 0,
    );
    assert.deepEqual(readEventTags(master), []);
    assert(!reopened.events("alice").some((e) => e.tags.includes("Exam")));
    assert.equal(getAccount("bob").tags.length, 0);
    const conflicted = {
      ...structuredClone(base),
      id: "conflict",
      extendedProperties: { shared: { hypercalTags: '["Exam"]' } },
    };
    records.set("conflict", conflicted);
    conflict = true;
    service.enqueue("alice", calendar, [conflicted]);
    await wait(() => !!service.status("alice").error);
    assert.deepEqual(readEventTags(conflicted), ["Exam"]);
    assert.equal(writes.length, 3);
    upsertAccount("alice", {
      tags: [{ name: "Exam", rule: { ...rule, mode: "event" } }],
    });
    service.changed("alice");
    assert.equal(service.status("alice").pending, 0);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
