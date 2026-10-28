import test from "node:test";
import assert from "node:assert/strict";
import { copiedEventBody } from "../server/copy-event.mjs";

test("copy preserves all-day boundaries and excludes provider identity, series and guests", () => {
  const source = {
    summary: "Trip",
    description: "Notes",
    location: "Paris",
    start: { date: "2026-10-28" },
    end: { date: "2026-10-31" },
    reminders: { useDefault: true },
    visibility: "private",
    transparency: "opaque",
    id: "original",
    etag: "v1",
    recurringEventId: "series",
    recurrence: ["RRULE:FREQ=WEEKLY"],
    attendees: [{ email: "friend@example.test" }],
    organizer: { email: "owner@example.test" },
    conferenceData: { conferenceId: "private" },
    attachments: [{ fileUrl: "private" }],
  };
  const result = copiedEventBody(source);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "summary",
      "description",
      "location",
      "start",
      "end",
      "reminders",
      "visibility",
      "transparency",
    ].sort(),
  );
  assert.deepEqual(result.start, source.start);
  assert.deepEqual(result.end, source.end);
  result.start.date = "2027-01-01";
  assert.equal(source.start.date, "2026-10-28");
});

test("copy preserves timed event zones and notification settings", () => {
  const source = {
    summary: "Lesson",
    start: {
      dateTime: "2026-10-28T10:00:00+01:00",
      timeZone: "Europe/Bratislava",
    },
    end: {
      dateTime: "2026-10-28T11:00:00+01:00",
      timeZone: "Europe/Bratislava",
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 10 }],
    },
  };
  assert.deepEqual(copiedEventBody(source), source);
});

test("copy rejects cancelled or unavailable events", () => {
  for (const source of [
    {},
    {
      status: "cancelled",
      start: { date: "2026-10-28" },
      end: { date: "2026-10-29" },
    },
  ])
    assert.throws(
      () => copiedEventBody(source),
      (error) => error.status === 404,
    );
});
