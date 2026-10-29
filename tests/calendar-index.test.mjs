import test from "node:test";
import assert from "node:assert/strict";
import { addDays, startOfDay } from "date-fns";
import {
  createCalendarIndex,
  calendarDay,
  dateForDay,
} from "../src/calendar-index.mjs";
import { spansDays, weekSegments } from "../src/domain.mjs";
const event = (id, start, end, allDay = false) => ({
  id,
  calendarId: "c",
  title: id,
  start,
  end,
  allDay,
});
const parse = (s) => new Date(s.length === 10 ? s + "T00:00:00" : s);
const overlaps = (e, d) =>
  parse(e.start) < addDays(startOfDay(d), 1) && parse(e.end) > startOfDay(d);
test("indexed days match overlap, midnight and ribbon semantics across DST and time zones", () => {
  const previousTZ = process.env.TZ;
  try {
    for (const zone of ["Europe/Prague", "America/New_York", "UTC"]) {
      process.env.TZ = zone;
      const data = [
        event("trip", "2026-10-20", "2026-11-02", true),
        event(
          "midnight",
          "2026-10-24T22:00:00+02:00",
          "2026-10-25T00:00:00+02:00",
        ),
        event(
          "overnight",
          "2026-10-24T23:30:00+02:00",
          "2026-10-25T03:00:00+01:00",
        ),
        event(
          "short",
          "2026-10-25T09:00:00+01:00",
          "2026-10-25T10:00:00+01:00",
        ),
        event("outside", "2025-01-01", "2025-01-02", true),
      ];
      const index = createCalendarIndex(data);
      for (let i = 0; i < 30; i++) {
        const d = addDays(new Date(2026, 9, 15), i),
          number = calendarDay(d),
          bucket = index.day(number);
        assert.equal(calendarDay(dateForDay(number)), number);
        assert.deepEqual(
          bucket.all,
          data.filter((e) => overlaps(e, d)),
          zone,
        );
        assert.deepEqual(
          bucket.single,
          data
            .filter((e) => !e.allDay && !spansDays(e) && overlaps(e, d))
            .sort((a, b) => a.start.localeCompare(b.start)),
        );
        assert.deepEqual(
          index.week(number).ribbons,
          weekSegments(
            data.filter((e) => e.allDay || spansDays(e)),
            d,
          ),
        );
        for (const p of bucket.positioned) {
          assert(p.top >= 0);
          assert(p.bottom <= 1440);
        }
      }
    }
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
test("background updates reuse unaffected day/week models, but update changed and deleted events", () => {
  const a = event("a", "2026-10-01", "2026-10-02", true),
    b = event("b", "2026-11-01", "2026-11-02", true);
  const oct = calendarDay(new Date(2026, 9, 1)),
    nov = calendarDay(new Date(2026, 10, 1));
  const first = createCalendarIndex([a, b]);
  const day = first.day(oct),
    week = first.week(oct),
    changedDay = first.day(nov);
  const second = createCalendarIndex([a, { ...b, title: "Changed" }], first);
  assert.equal(second.day(oct), day);
  assert.equal(second.week(oct), week);
  assert.notEqual(second.day(nov), changedDay);
  const third = createCalendarIndex([a], second);
  assert.equal(third.day(nov).all.length, 0);
  assert.equal(third.day(oct), day);
});
test("long spanning events are bounded by queried days and cached models stay bounded", () => {
  const data = [event("long", "2000-01-01", "2099-12-31", true)];
  const index = createCalendarIndex(data);
  const start = calendarDay(new Date(2026, 0, 1));
  for (let i = 0; i < 1000; i++)
    assert.equal(index.day(start + i).all[0], data[0]);
  assert(index.days.size <= 512);
  assert.equal(index.allDay(start, 21).length, 1);
});

test("changing the device timezone rebuilds cached civil days for existing event objects", () => {
  const previousTZ = process.env.TZ;
  const data = [
    event("travel", "2026-10-25T00:30:00Z", "2026-10-25T01:00:00Z"),
  ];
  try {
    process.env.TZ = "Europe/Prague";
    const first = createCalendarIndex(data);
    const day = calendarDay(new Date(2026, 9, 25));
    assert.equal(first.day(day).all.length, 1);
    process.env.TZ = "America/New_York";
    const next = createCalendarIndex(data, first);
    assert.equal(next.day(day).all.length, 0);
    assert.equal(next.day(day - 1).all.length, 1);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
