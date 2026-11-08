import { RE2 } from "re2-wasm";
import { z } from "zod";
import { cleanTags } from "../src/tags.mjs";
const compiled = new Map();
export function rulePattern(value) {
  if (!value) return null;
  if (compiled.has(value)) return compiled.get(value);
  let pattern;
  try {
    pattern = new RE2(value, "iu");
  } catch {
    throw Object.assign(
      new Error(
        "Invalid tag regex. Use a pattern without / delimiters, lookarounds or backreferences.",
      ),
      { status: 400, expose: true },
    );
  }
  if (compiled.size >= 128) compiled.delete(compiled.keys().next().value);
  compiled.set(value, pattern);
  return pattern;
}
const criterionSchema = z.object({
  // any: all calendars; only: the listed calendars; except: every other calendar.
  calendarMode: z.enum(["any", "only", "except"]).default("any"),
  calendarIds: z.array(z.string().min(1).max(1024)).max(40).default([]),
  include: z.string().max(500).default(""),
  exclude: z.string().max(500).default(""),
});
// Saved pre-union rules have only top-level calendarIds/include/exclude.
// They are read as one criterion; no stored data needs rewriting.
export function ruleCriteria(rule) {
  if (Array.isArray(rule?.criteria) && rule.criteria.length)
    return rule.criteria.map((c) => ({
      calendarMode: c.calendarMode || (c.calendarIds?.length ? "only" : "any"),
      calendarIds: c.calendarIds || [],
      include: c.include || "",
      exclude: c.exclude || "",
    }));
  return [
    {
      calendarMode: rule?.calendarIds?.length ? "only" : "any",
      calendarIds: rule?.calendarIds || [],
      include: rule?.include || "",
      exclude: rule?.exclude || "",
    },
  ];
}
export function criterionCoversCalendar(criterion, calendarId) {
  if (
    criterion.calendarMode === "only" ||
    criterion.calendarMode === "except"
  ) {
    const listed = criterion.calendarIds.includes(calendarId);
    return criterion.calendarMode === "only" ? listed : !listed;
  }
  return true;
}
export function ruleCoversCalendar(rule, calendarId) {
  return ruleCriteria(rule).some((c) => criterionCoversCalendar(c, calendarId));
}
export const tagRuleSchema = z
  .object({
    mode: z.enum(["event", "automatic"]).default("event"),
    calendarIds: z.array(z.string().min(1).max(1024)).max(40).default([]),
    include: z.string().max(500).default(""),
    exclude: z.string().max(500).default(""),
    criteria: z.array(criterionSchema).max(20).optional(),
  })
  .superRefine((rule, ctx) => {
    for (const field of ["include", "exclude"]) {
      try {
        rulePattern(rule[field]);
      } catch (error) {
        ctx.addIssue({ code: "custom", path: [field], message: error.message });
      }
    }
    (rule.criteria || []).forEach((criterion, index) => {
      for (const field of ["include", "exclude"]) {
        try {
          rulePattern(criterion[field]);
        } catch (error) {
          ctx.addIssue({
            code: "custom",
            path: ["criteria", index, field],
            message: error.message,
          });
        }
      }
    });
  })
  .transform((rule) =>
    rule.criteria?.length
      ? // Criteria are authoritative; legacy mirrors are cleared so they cannot
        // be mistaken for a second, conflicting criterion.
        { ...rule, calendarIds: [], include: "", exclude: "" }
      : rule,
  );
function matchesCriterion(criterion, event, text) {
  return (
    criterionCoversCalendar(criterion, event.calendarId) &&
    (!criterion.include || rulePattern(criterion.include).test(text)) &&
    (!criterion.exclude || !rulePattern(criterion.exclude).test(text))
  );
}
export function matchesTagRule(rule, event) {
  if (rule?.mode !== "automatic") return false;
  const text = `${event.title || ""}\n${event.description || ""}\n${event.location || ""}`;
  return ruleCriteria(rule).some((c) => matchesCriterion(c, event, text));
}
export function automaticEventTags(definitions = [], event) {
  const automatic = definitions.filter((tag) => tag.rule?.mode === "automatic");
  if (!automatic.length) return cleanTags(event.tags || []);
  const names = new Set(automatic.map((tag) => tag.name));
  const values = [
    ...(event.tags || []).filter((name) => !names.has(name)),
    ...automatic
      .filter((tag) => matchesTagRule(tag.rule, event))
      .map((tag) => tag.name),
  ];
  const result = [];
  for (const name of cleanTags(values)) {
    if (Buffer.byteLength(JSON.stringify([...result, name])) <= 1024)
      result.push(name);
  }
  return result;
}
