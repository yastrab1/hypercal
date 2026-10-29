import { addDays, format, startOfDay } from "date-fns";

const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// All dates are local calendar dates. Never use elapsed milliseconds across DST.
export function parseQuickDate(text, now = new Date()) {
  const pattern =
    /\b(?:in\s+(\d{1,4})\s+(day|week)s?|today|tomorrow|tmrw|(?:next\s+)?(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|\d{1,2}\.\d{1,2}\.(?:\d{4})?|\d{1,2}\.\d{1,2})(?![\w.])/gi;
  let result = null;
  for (const match of text.matchAll(pattern)) {
    // Avoid reading parts of emails, identifiers, decimals with extra dots, etc.
    if (match.index && !/[\s(]/.test(text[match.index - 1])) continue;
    const phrase = match[0].toLowerCase();
    let date = startOfDay(now);
    if (match[1])
      date = addDays(
        date,
        Number(match[1]) * (match[2].toLowerCase() === "week" ? 7 : 1),
      );
    else if (["tomorrow", "tmrw"].includes(phrase)) date = addDays(date, 1);
    else if (phrase !== "today") {
      if (/^\d/.test(phrase)) {
        const [day, month, specifiedYear] = phrase.split(".").map(Number);
        if (specifiedYear && specifiedYear < 1000) continue;
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        let valid = null;
        for (
          let year = specifiedYear || date.getFullYear();
          year <= (specifiedYear || date.getFullYear() + 8);
          year++
        ) {
          const candidate = new Date(year, month - 1, day);
          if (
            candidate.getMonth() === month - 1 &&
            candidate.getDate() === day &&
            (specifiedYear || candidate >= date)
          ) {
            valid = candidate;
            break;
          }
        }
        if (!valid) continue;
        date = valid;
      } else {
        const weekday = weekdays.indexOf(
          phrase.replace(/^next\s+/, "").slice(0, 3),
        );
        let delta = (weekday - date.getDay() + 7) % 7;
        if (phrase.startsWith("next ") && delta === 0) delta = 7;
        date = addDays(date, delta);
      }
    }
    result = {
      from: match.index,
      to: match.index + match[0].length,
      phrase: match[0],
      date: format(date, "yyyy-MM-dd"),
    };
  }
  return result;
}
export function withoutDatePhrase(text, match) {
  return (match ? text.slice(0, match.from) + text.slice(match.to) : text)
    .replace(/\s+/g, " ")
    .trim();
}
const folded = (value) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
export function findCalendars(calendars, query) {
  const needle = folded(query).replace(/\s/g, "");
  return calendars
    .filter((c) => !c.readOnly)
    .map((c) => {
      const haystack = folded(c.name);
      let position = -1,
        gaps = 0,
        first = -1;
      for (const letter of needle) {
        const next = haystack.indexOf(letter, position + 1);
        if (next < 0) return { calendar: c, score: Infinity };
        if (first < 0) first = next;
        gaps += next - position - 1;
        position = next;
      }
      return {
        calendar: c,
        score: !needle
          ? 0
          : haystack === needle
            ? -100
            : haystack.startsWith(needle)
              ? -50
              : gaps + first,
      };
    })
    .filter((x) => Number.isFinite(x.score))
    .sort(
      (a, b) =>
        a.score - b.score || a.calendar.name.localeCompare(b.calendar.name),
    )
    .slice(0, 8)
    .map((x) => x.calendar);
}
export function calendarMention(text, caret) {
  const prefix = text.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]*)$/.exec(prefix);
  return match
    ? { from: prefix.length - match[1].length - 1, to: caret, query: match[1] }
    : null;
}
