import { createHash } from "node:crypto";
import { cleanTags, readEventTags } from "../src/tags.mjs";
export function tagKey(name) {
  return "hct_" + createHash("sha256").update(name).digest("hex").slice(0, 32);
}
export function googleTagFields(tags, previous = []) {
  if (tags === undefined) return {};
  const names = cleanTags(tags);
  return {
    shared: {
      hypercalTags: JSON.stringify(names),
      ...Object.fromEntries(
        cleanTags(previous).map((name) => [tagKey(name), "0"]),
      ),
      ...Object.fromEntries(names.map((name) => [tagKey(name), "1"])),
    },
  };
}
export { readEventTags };
