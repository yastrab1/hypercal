import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesTagRule,
  automaticEventTags,
  tagRuleSchema,
} from "../server/tag-rules.mjs";
const rule = {
  mode: "automatic",
  calendarIds: ["school"],
  include: "exam|test",
  exclude: "practice",
};
const event = {
  calendarId: "school",
  title: "CHE exam",
  description: "",
  location: "",
  tags: ["Manual"],
};
test("automatic tag filters combine calendars and include regex, with exclusion taking precedence", () => {
  assert(matchesTagRule(rule, event));
  assert(!matchesTagRule(rule, { ...event, calendarId: "personal" }));
  assert(!matchesTagRule(rule, { ...event, title: "Lesson" }));
  assert(!matchesTagRule(rule, { ...event, title: "Practice TEST" }));
  assert(
    matchesTagRule({ ...rule, include: "" }, { ...event, title: "Lesson" }),
  );
  assert(
    matchesTagRule(
      { ...rule, calendarIds: [] },
      { ...event, calendarId: "personal" },
    ),
  );
  assert(
    matchesTagRule(
      { ...rule, include: "room 12" },
      { ...event, title: "Lesson", location: "Room 12" },
    ),
  );
  assert(
    matchesTagRule(
      { ...rule, include: "deadline" },
      { ...event, title: "Lesson", description: "Deadline" },
    ),
  );
  assert(!matchesTagRule({ ...rule, mode: "event" }, event));
});
test("automatic tags replace their own prior matches and preserve manual assignments", () => {
  const tags = [{ name: "Exam", rule }, { name: "Manual" }];
  assert.deepEqual(automaticEventTags(tags, event), ["Manual", "Exam"]);
  assert.deepEqual(
    automaticEventTags(tags, {
      ...event,
      title: "practice exam",
      tags: ["Exam", "Manual"],
    }),
    ["Manual"],
  );
  assert.deepEqual(
    automaticEventTags([{ name: "Exam", rule: { ...rule, mode: "event" } }], {
      ...event,
      tags: ["Exam"],
    }),
    ["Exam"],
  );
  const many = Array.from({ length: 40 }, (_, i) => ({
    name: `Tag${i}`,
    rule: { ...rule, calendarIds: [] },
  }));
  assert.equal(automaticEventTags(many, event).length, 12);
});
test("tag regex validation rejects unsafe unsupported syntax and handles nested repetition without backtracking", () => {
  assert(!tagRuleSchema.safeParse({ ...rule, include: "[" }).success);
  assert(!tagRuleSchema.safeParse({ ...rule, exclude: "(?=exam)" }).success);
  assert(tagRuleSchema.safeParse(rule).success);
  assert(
    !matchesTagRule(
      { ...rule, include: "^(a+)+$" },
      { ...event, title: "a".repeat(100000) + "!" },
    ),
  );
});
