import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("new calendars join all owned views without undoing existing exclusions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hypercal-calendars-"));
  process.env.DATA_DIR = dir;
  const { upsertAccount, getAccount, discoverCalendars, includeNewCalendars } =
    await import("../server/store.mjs");
  try {
    upsertAccount("alice", {
      views: [
        { id: "month", calendarIds: ["personal"] },
        { id: "school", calendarIds: [] },
      ],
    });
    upsertAccount("bob", { views: [{ id: "private", calendarIds: [] }] });
    discoverCalendars("alice", ["personal", "hidden"]);
    assert.deepEqual(getAccount("alice").views[1].calendarIds, []);
    discoverCalendars("alice", ["personal", "hidden", "new"]);
    assert.deepEqual(
      getAccount("alice").views.map((v) => v.calendarIds),
      [["personal", "new"], ["new"]],
    );
    includeNewCalendars("alice", ["created", "created"]);
    discoverCalendars("alice", ["personal", "hidden", "new", "created"]);
    assert.deepEqual(getAccount("alice").views[1].calendarIds, [
      "new",
      "created",
    ]);
    assert.deepEqual(getAccount("bob").views[0].calendarIds, []);
    includeNewCalendars("bob", ["first-created"]);
    discoverCalendars("bob", ["first-created", "previously-excluded"]);
    assert.deepEqual(getAccount("bob").views[0].calendarIds, ["first-created"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
