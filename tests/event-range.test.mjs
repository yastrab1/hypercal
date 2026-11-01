import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAllDayRange } from "../src/event-range.mjs";
import { createCalendarIndex, calendarDay } from "../src/calendar-index.mjs";
import { weekSegments } from "../src/domain.mjs";
import { createCalendarCache } from "../src/cache.mjs";

test("same-date all-day provider events occupy one day in day, week and month indexes across DST", () => {
  const oldTZ = process.env.TZ;
  try {
    for (const zone of ["UTC", "Europe/Prague", "America/New_York"]) {
      process.env.TZ = zone;
      for (const [start, end] of [
        ["2026-10-25", "2026-10-26"],
        ["2026-03-29", "2026-03-30"],
        ["2028-02-29", "2028-03-01"],
        ["2026-12-31", "2027-01-01"],
      ]) {
        const raw = {
          id: "aero",
          calendarId: "aerostacks",
          title: "Aerostacks event",
          start,
          end: start,
          allDay: true,
        };
        const fixed = normalizeAllDayRange(raw);
        assert.equal(fixed.end, end);
        assert.equal(raw.end, start);
        const date = new Date(start + "T00:00:00"),
          day = calendarDay(date);
        const index = createCalendarIndex([fixed]);
        assert.equal(index.day(day).all.length, 1);
        assert.equal(index.allDay(day, 7).length, 1);
        assert.equal(index.week(day).ribbons[0].end, 1);
        assert.equal(index.day(day + 1).all.length, 0);
        assert.equal(weekSegments([fixed], date)[0].end, 1);
      }
    }
  } finally {
    if (oldTZ === undefined) delete process.env.TZ;
    else process.env.TZ = oldTZ;
  }
});
test("valid multi-day spans, timed events and invalid date strings are unchanged", () => {
  for (const event of [
    { allDay: true, start: "2026-10-01", end: "2026-10-04" },
    {
      allDay: false,
      start: "2026-10-01T12:00:00Z",
      end: "2026-10-01T12:00:00Z",
    },
    { allDay: true, start: "2026-02-30", end: "2026-02-30" },
  ])
    assert.equal(normalizeAllDayRange(event), event);
});
test("existing offline event caches are repaired without dropping calendar data", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const user = { id: "alice", email: "alice@example.test" };
  const cache = createCalendarCache(storage);
  cache.writeMetadata(user, [{ id: "aerostacks" }], []);
  cache.writeRange(
    user,
    "october",
    [
      {
        id: "aero",
        calendarId: "aerostacks",
        start: "2026-10-25",
        end: "2026-10-25",
        allDay: true,
      },
    ],
    new Date().toISOString(),
  );
  const reopened = createCalendarCache(storage);
  const event = reopened.readLast().ranges.october.events[0];
  assert.equal(event.end, "2026-10-26");
  assert.equal(reopened.readLast().calendars[0].id, "aerostacks");
  assert.equal(reopened.readLast().ranges.october.events[0], event);
});
