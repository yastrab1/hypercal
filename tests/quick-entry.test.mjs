import test from "node:test";
import assert from "node:assert/strict";
import {
  parseQuickDate,
  withoutDatePhrase,
  findCalendars,
  calendarMention,
} from "../src/quick-entry.mjs";
const today = new Date(2026, 9, 29, 14, 0);
test("quick dates resolve relative days, short names, weekdays and European dates", () => {
  for (const [phrase, date] of [
    ["in 2 days", "2026-10-31"],
    ["tmrw", "2026-10-30"],
    ["tomorrow", "2026-10-30"],
    ["mon", "2026-11-02"],
    ["Monday", "2026-11-02"],
    ["11.2", "2027-02-11"],
    ["11.2.2028", "2028-02-11"],
    ["today", "2026-10-29"],
    ["thu", "2026-10-29"],
    ["next thu", "2026-11-05"],
    ["in 2 weeks", "2026-11-12"],
    ["29.2", "2028-02-29"],
  ]) {
    const input = `Test event ${phrase}`;
    const result = parseQuickDate(input, today);
    assert.equal(result?.date, date, phrase);
    assert.equal(withoutDatePhrase(input, result), "Test event");
  }
});
test("invalid dates and pieces of identifiers remain literal", () => {
  for (const title of [
    "Report 31.2",
    "Version v11.2",
    "mail@mon.com",
    "in 2 daylight",
    "money",
    "11.2.2026extra",
    "31.4.2027",
  ])
    assert.equal(parseQuickDate(title, today), null, title);
});
test("date parsing uses calendar days across daylight-saving changes", () => {
  assert.equal(
    parseQuickDate("Walk in 2 days", new Date(2026, 2, 28, 23)).date,
    "2026-03-30",
  );
});
test("last date phrase wins and earlier title words are preserved", () => {
  const text = "Review mon tmrw";
  assert.equal(
    withoutDatePhrase(text, parseQuickDate(text, today)),
    "Review mon",
  );
});
test("calendar selection is accent-insensitive, fuzzy and excludes read-only calendars", () => {
  const calendars = [
    { id: "a", name: "Škola", readOnly: false },
    { id: "b", name: "Personal", readOnly: false },
    { id: "c", name: "School holidays", readOnly: true },
  ];
  assert.deepEqual(
    findCalendars(calendars, "skl").map((c) => c.id),
    ["a"],
  );
  assert.deepEqual(
    findCalendars(calendars, "PRS").map((c) => c.id),
    ["b"],
  );
  assert.equal(findCalendars(calendars, "absent").length, 0);
  const text = "Exam in 2 days @sko";
  assert.deepEqual(calendarMention(text, text.length), {
    from: 15,
    to: 19,
    query: "sko",
  });
  assert.equal(calendarMention("email@example.com", 17), null);
});
