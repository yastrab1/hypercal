import test from "node:test";
import assert from "node:assert/strict";
import { countdown, dayDistance, cleanTags } from "../src/tags.mjs";
import { googleTagFields, readEventTags, tagKey } from "../server/tags.mjs";
import { sharedICS } from "../server/shared-views.mjs";
import { parseFeed } from "../server/feeds.mjs";
test("countdowns use calendar days across DST, month lengths, leap years and the past", () => {
  const now = new Date(2026, 9, 24, 23, 30);
  assert.equal(countdown(new Date(2026, 9, 26), now), "2d");
  assert.equal(countdown(new Date(2026, 10, 25), now), "1mo 1d");
  assert.equal(
    countdown(new Date(2028, 1, 29), new Date(2028, 0, 29)),
    "1mo 0d",
  );
  assert.equal(countdown(new Date(2027, 11, 24), now), "14mo 0d");
  assert.equal(dayDistance(new Date(2026, 9, 23), now), "1 day ago");
  assert.equal(dayDistance(new Date(2026, 9, 24), now), "Today");
});
test("tag metadata preserves Unicode and removes obsolete searchable keys", () => {
  const tags = ["Final, exam", "Škola", "Final, exam"];
  assert.deepEqual(cleanTags(tags), ["Final, exam", "Škola"]);
  const fields = googleTagFields(tags, ["Old tag"]);
  assert.equal(fields.shared[tagKey("Old tag")], "0");
  assert.equal(fields.shared[tagKey("Škola")], "1");
  assert(tagKey("Škola").length <= 44);
  assert.deepEqual(readEventTags({ extendedProperties: fields }), [
    "Final, exam",
    "Škola",
  ]);
  assert.deepEqual(
    readEventTags({
      extendedProperties: { shared: { hypercalTags: "broken" } },
    }),
    [],
  );
});
test("tags round-trip through standard iCalendar CATEGORIES, including escaped commas", () => {
  const text = sharedICS(
    [
      {
        id: "one",
        title: "Exam",
        start: "2027-01-20",
        end: "2027-01-21",
        allDay: true,
        tags: ["Final, exam", "Škola"],
      },
    ],
    "Tagged view",
  );
  assert.match(text, /CATEGORIES:Final\\, exam,Škola/);
  const parsed = parseFeed(text, { id: "feed" }, "2027-01-01", "2027-02-01");
  assert.deepEqual(parsed[0].tags, ["Final, exam", "Škola"]);
});
