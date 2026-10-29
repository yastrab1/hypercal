import test from "node:test";
import assert from "node:assert/strict";
import { scopedEventBody } from "../server/event-body.mjs";
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
