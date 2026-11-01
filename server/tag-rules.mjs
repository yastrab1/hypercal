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
export const tagRuleSchema = z
  .object({
    mode: z.enum(["event", "automatic"]).default("event"),
    calendarIds: z.array(z.string().min(1).max(1024)).max(40).default([]),
    include: z.string().max(500).default(""),
    exclude: z.string().max(500).default(""),
  })
  .superRefine((rule, ctx) => {
    for (const field of ["include", "exclude"]) {
      try {
        rulePattern(rule[field]);
      } catch (error) {
        ctx.addIssue({ code: "custom", path: [field], message: error.message });
      }
    }
  });
export function matchesTagRule(rule, event) {
  if (rule?.mode !== "automatic") return false;
  if (rule.calendarIds?.length && !rule.calendarIds.includes(event.calendarId))
    return false;
  const text = `${event.title || ""}\n${event.description || ""}\n${event.location || ""}`;
  return (
    (!rule.include || rulePattern(rule.include).test(text)) &&
    (!rule.exclude || !rulePattern(rule.exclude).test(text))
  );
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
