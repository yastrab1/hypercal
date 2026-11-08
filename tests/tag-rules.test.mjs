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
import { ruleCriteria, ruleCoversCalendar } from "../server/tag-rules.mjs";
const union = {
  mode: "automatic",
  criteria: [
    { calendarMode: "only", calendarIds: ["school"], include: "", exclude: "" },
    {
      calendarMode: "except",
      calendarIds: ["school"],
      include: "exam|deadline",
      exclude: "practice",
    },
  ],
};
test("criteria union: every event of one calendar OR regex matches in all other calendars", () => {
  assert(matchesTagRule(union, { ...event, title: "Lunch" }));
  assert(matchesTagRule(union, { ...event, title: "practice lunch" }));
  const other = { ...event, calendarId: "work", title: "Lunch" };
  assert(!matchesTagRule(union, other));
  assert(matchesTagRule(union, { ...other, title: "Exam prep" }));
  assert(matchesTagRule(union, { ...other, description: "Deadline" }));
  assert(!matchesTagRule(union, { ...other, title: "practice exam" }));
  assert(ruleCoversCalendar(union, "work"));
  assert(
    !ruleCoversCalendar({ ...union, criteria: [union.criteria[0]] }, "work"),
  );
});
test("multiple regex criteria in the same calendar scope are ORed", () => {
  const rule = {
    mode: "automatic",
    criteria: [
      { calendarMode: "any", include: "alpha" },
      { calendarMode: "any", include: "beta" },
    ],
  };
  assert(matchesTagRule(rule, { ...event, title: "Alpha" }));
  assert(matchesTagRule(rule, { ...event, title: "beta" }));
  assert(!matchesTagRule(rule, { ...event, title: "gamma" }));
});
test("legacy saved rules without criteria keep their exact behavior", () => {
  assert.deepEqual(ruleCriteria(rule), [
    {
      calendarMode: "only",
      calendarIds: ["school"],
      include: "exam|test",
      exclude: "practice",
    },
  ]);
  assert.equal(ruleCriteria({ mode: "automatic" })[0].calendarMode, "any");
  assert(ruleCoversCalendar({ ...rule, calendarIds: [] }, "anything"));
});
test("criteria schema validates every regex, caps size, and clears legacy mirrors", () => {
  const parsed = tagRuleSchema.parse({
    ...union,
    calendarIds: ["x"],
    include: "y",
  });
  assert.deepEqual(parsed.calendarIds, []);
  assert.equal(parsed.include, "");
  assert.equal(parsed.criteria.length, 2);
  assert(
    !tagRuleSchema.safeParse({
      mode: "automatic",
      criteria: [{ include: "ok" }, { exclude: "(?=x)" }],
    }).success,
  );
  assert(
    !tagRuleSchema.safeParse({
      mode: "automatic",
      criteria: Array.from({ length: 21 }, () => ({})),
    }).success,
  );
  // Old payloads still parse unchanged.
  assert.deepEqual(tagRuleSchema.parse(rule).calendarIds, ["school"]);
});
