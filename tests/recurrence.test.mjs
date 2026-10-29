import test from "node:test";
import assert from "node:assert/strict";
import {
  splitRules,
  shiftWeekdays,
  shiftSeriesTime,
  changeRecurring,
} from "../server/recurrence.mjs";
const master = {
  id: "series",
  etag: "master-v1",
  summary: "Weekly",
  start: { dateTime: "2026-10-19T09:00:00+02:00", timeZone: "Europe/Prague" },
  end: { dateTime: "2026-10-19T10:00:00+02:00", timeZone: "Europe/Prague" },
  recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5;BYDAY=MO"],
};
const occurrence = {
  id: "instance",
  etag: "instance-v1",
  summary: "Weekly",
  recurringEventId: "series",
  originalStartTime: { dateTime: "2026-11-02T09:00:00+01:00" },
  start: { dateTime: "2026-11-02T09:00:00+01:00" },
  end: { dateTime: "2026-11-02T10:00:00+01:00" },
};
test("following split retains COUNT and trims before original start across DST", () => {
  const r = splitRules(master, occurrence.originalStartTime);
  assert.match(r.before[0], /UNTIL=20261102T075959Z/);
  assert(!r.before[0].includes("COUNT="));
  assert.match(r.after[0], /COUNT=3/);
});
test("all-day split counts the selected occurrence correctly and partitions explicit dates", () => {
  const m = {
    ...master,
    start: { date: "2026-10-19" },
    end: { date: "2026-10-20" },
    recurrence: [
      "RRULE:FREQ=WEEKLY;COUNT=5",
      "RDATE;VALUE=DATE:20261020,20261103",
      "EXDATE;VALUE=DATE:20261026,20261109",
    ],
  };
  const r = splitRules(m, { date: "2026-11-02" });
  assert.match(r.before[0], /UNTIL=20261101/);
  assert.match(r.after[0], /COUNT=3/);
  assert(r.before.includes("RDATE;VALUE=DATE:20261020"));
  assert(r.after.includes("RDATE;VALUE=DATE:20261103"));
  assert(r.before.includes("EXDATE;VALUE=DATE:20261026"));
  assert(r.after.includes("EXDATE;VALUE=DATE:20261109"));
  assert.equal(splitRules(m, { date: "2026-10-19" }).first, true);
});
test("series shifts preserve local clock changes rather than DST offset differences", () => {
  const value = shiftSeriesTime(
    master.start,
    occurrence.start,
    { dateTime: "2026-11-02T10:00:00+01:00" },
    "Europe/Prague",
  );
  assert.equal(value.dateTime, "2026-10-19T08:00:00.000Z"); // 10:00 CEST
});
function harness({ trimFails = false, insertFails = false } = {}) {
  const calls = [];
  const request = async (id, path, options = {}) => {
    calls.push({ path, ...options });
    if (!options.method) {
      if (path.includes("/instances?")) return { items: [] };
      return structuredClone(path.endsWith("/instance") ? occurrence : master);
    }
    if (options.method === "POST") {
      if (insertFails) throw new Error("insert failed");
      return { ...options.body, id: "new-series", etag: "new-v1" };
    }
    if (options.method === "PATCH" && options.body.recurrence && trimFails)
      throw new Error("trim failed");
    return {
      ...(path.endsWith("/instance") ? occurrence : master),
      ...options.body,
    };
  };
  const cache = { events: () => [], remember: () => {}, remove: () => {} };
  const body = (draft, target, instance) =>
    instance
      ? { summary: draft.title }
      : { summary: draft.title, start: occurrence.start, end: occurrence.end };
  const run = (extra) =>
    changeRecurring({
      id: "alice",
      calendarId: "cal",
      eventId: "instance",
      etag: "instance-v1",
      draft: { title: "New title" },
      body,
      normalize: (e) => e,
      request,
      cache,
      ...extra,
    });
  return { calls, run };
}
test("instance edit targets only the occurrence and checks its etag", async () => {
  const h = harness();
  await h.run({ scope: "instance" });
  assert.equal(
    h.calls.filter((c) => c.method === "PATCH")[0].path,
    "calendars/cal/events/instance",
  );
  const conflict = harness();
  await assert.rejects(
    conflict.run({ scope: "all", etag: "stale" }),
    (e) => e.status === 412,
  );
  assert(!conflict.calls.some((c) => c.method));
});
test("all edit targets the master, preserving its recurrence and original start", async () => {
  const h = harness();
  await h.run({ scope: "all" });
  const call = h.calls.find((c) => c.method === "PATCH");
  assert.equal(call.path, "calendars/cal/events/series");
  assert.equal(call.etag, "master-v1");
  assert.deepEqual(call.body, { summary: "New title" });
});
test("following edit creates the new series and trims the original at the selected boundary", async () => {
  const h = harness();
  await h.run({ scope: "following" });
  const insert = h.calls.find((c) => c.method === "POST"),
    trim = h.calls.find((c) => c.method === "PATCH");
  assert.equal(insert.body.start.dateTime, occurrence.start.dateTime);
  assert.match(insert.body.recurrence[0], /COUNT=3/);
  assert.match(trim.body.recurrence[0], /UNTIL=20261102T075959Z/);
});
test("failed trim rolls back the new series; failed insert never trims the original", async () => {
  const h = harness({ trimFails: true });
  await assert.rejects(h.run({ scope: "following" }), /trim failed/);
  assert(
    h.calls.some(
      (c) => c.method === "DELETE" && c.path.endsWith("/new-series"),
    ),
  );
  const f = harness({ insertFails: true });
  await assert.rejects(f.run({ scope: "following" }), /insert failed/);
  assert(!f.calls.some((c) => c.method === "PATCH"));
});
test("following deletion only trims while all deletion removes the master", async () => {
  const h = harness();
  await h.run({ scope: "following", remove: true });
  assert(h.calls.some((c) => c.method === "PATCH"));
  assert(!h.calls.some((c) => c.method === "DELETE" || c.method === "POST"));
  const a = harness();
  await a.run({ scope: "all", remove: true });
  assert(
    a.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/series")),
  );
});

test("moving a weekly series shifts explicit weekdays", () => {
  assert.deepEqual(
    shiftWeekdays(
      ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5"],
      { date: "2026-11-02" },
      { date: "2026-11-03" },
      "UTC",
    ),
    ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=5"],
  );
});
