import test from "node:test";
import assert from "node:assert/strict";
import {
  scopedEventBody,
  eventBody,
  recurrenceRule,
} from "../server/event-body.mjs";
const master = {
  summary: "School",
  description: "Series notes",
  location: "Room",
  start: { dateTime: "2026-10-19T09:00:00+02:00", timeZone: "Europe/Prague" },
  end: { dateTime: "2026-10-19T10:00:00+02:00", timeZone: "Europe/Prague" },
};
const occurrence = {
  ...master,
  start: { dateTime: "2026-11-02T09:00:00+01:00" },
  end: { dateTime: "2026-11-02T10:00:00+01:00" },
};
const draft = {
  calendarId: "school",
  title: "School",
  description: "Series notes",
  location: "Room",
  start: "2026-11-02T08:00:00Z",
  end: "2026-11-02T09:00:00Z",
  timeZone: "Europe/Prague",
  allDay: false,
  color: null,
  tags: ["Exam"],
};
test("tag-only series edits do not overwrite the series date, title, notes or color", () => {
  const body = scopedEventBody(draft, master, occurrence);
  assert.deepEqual(Object.keys(body), ["extendedProperties"]);
  assert.equal(body.extendedProperties.shared.hypercalTags, '["Exam"]');
});
test("changed properties and notification settings propagate without replacing unrelated series fields", () => {
  const body = scopedEventBody(
    { ...draft, title: "Exam", location: "New room", reminderMinutes: 30 },
    master,
    occurrence,
  );
  assert.equal(body.summary, "Exam");
  assert.equal(body.location, "New room");
  assert.equal(body.description, undefined);
  assert.deepEqual(body.reminders, {
    useDefault: false,
    overrides: [{ method: "popup", minutes: 30 }],
  });
});
test("moving an occurrence shifts the all-events master by wall time across DST", () => {
  const body = scopedEventBody(
    { ...draft, start: "2026-11-02T09:00:00Z", end: "2026-11-02T10:00:00Z" },
    master,
    occurrence,
  );
  assert.equal(body.start.dateTime, "2026-10-19T08:00:00.000Z");
  assert.equal(body.end.dateTime, "2026-10-19T09:00:00.000Z");
});
const base = {
  title: "Birthday",
  description: "",
  location: "",
  start: "2027-02-28",
  end: "2027-03-01",
  allDay: true,
};
test("recurrence presets and custom every-N intervals become RFC 5545 rules", () => {
  const rule = (extra) => eventBody({ ...base, ...extra }).recurrence;
  assert.equal(rule({}), undefined);
  assert.equal(rule({ recurrence: "none" }), undefined);
  assert.deepEqual(rule({ recurrence: "daily" }), ["RRULE:FREQ=DAILY"]);
  assert.deepEqual(rule({ recurrence: "weekly" }), ["RRULE:FREQ=WEEKLY"]);
  assert.deepEqual(rule({ recurrence: "monthly" }), ["RRULE:FREQ=MONTHLY"]);
  assert.deepEqual(rule({ recurrence: "yearly" }), ["RRULE:FREQ=YEARLY"]);
  for (const [every, unit, expected] of [
    [1, "day", "FREQ=DAILY"],
    [10, "day", "FREQ=DAILY;INTERVAL=10"],
    [2, "month", "FREQ=MONTHLY;INTERVAL=2"],
    [5, "year", "FREQ=YEARLY;INTERVAL=5"],
  ])
    assert.deepEqual(
      rule({ recurrence: "custom", recurrenceInterval: { every, unit } }),
      ["RRULE:" + expected],
    );
});
test("custom recurrence rejects missing, non-positive, fractional or unknown intervals", () => {
  for (const recurrenceInterval of [
    undefined,
    { every: 0, unit: "day" },
    { every: -1, unit: "day" },
    { every: 1.5, unit: "day" },
    { every: 2, unit: "week" },
  ])
    assert.throws(
      () => recurrenceRule({ recurrence: "custom", recurrenceInterval }),
      /interval/,
    );
});
test("timed custom recurrence keeps the event time zone so DST does not shift wall-clock time", () => {
  const body = eventBody({
    ...base,
    allDay: false,
    start: "2027-03-27T08:00:00Z",
    end: "2027-03-27T09:00:00Z",
    timeZone: "Europe/Prague",
    recurrence: "custom",
    recurrenceInterval: { every: 2, unit: "day" },
  });
  assert.equal(body.start.timeZone, "Europe/Prague");
  assert.deepEqual(body.recurrence, ["RRULE:FREQ=DAILY;INTERVAL=2"]);
});
