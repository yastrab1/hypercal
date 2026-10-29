import { layoutEvents, weekSegments } from "./domain.mjs";

// Civil day numbers avoid DST's 23/25-hour days. Provider dates are parsed once
// per immutable event object, rather than once per cell on every render.
export const calendarDay = (date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
export const dateForDay = (day) => {
  const d = new Date(day * 86400000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
let parsed = new WeakMap(),
  parsedZone;
function metadata(event) {
  let value = parsed.get(event);
  if (value) return value;
  const parse = (s) => new Date(s.length === 10 ? s + "T00:00:00" : s);
  const start = parse(event.start),
    end = parse(event.end);
  value = {
    event,
    start: +start,
    end: +end,
    first: calendarDay(start),
    last: calendarDay(new Date(+end - 1)),
    startMinute: start.getHours() * 60 + start.getMinutes(),
    endMinute: end.getHours() * 60 + end.getMinutes(),
  };
  parsed.set(event, value);
  return value;
}
const same = (a, b) => a.length === b.length && a.every((e, i) => e === b[i]);
function bound(items, value, read) {
  let lo = 0,
    hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (read(items[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function createCalendarIndex(
  events,
  previous,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  if (parsedZone !== timeZone) {
    parsed = new WeakMap();
    parsedZone = timeZone;
  }
  if (previous?.timeZone !== timeZone) previous = undefined;
  const records = events
    .map(metadata)
    .filter((r) => Number.isFinite(r.start) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const maxEnd = [];
  let end = -Infinity;
  for (const r of records) {
    end = Math.max(end, r.end);
    maxEnd.push(end);
  }
  const days = new Map(),
    weeks = new Map();
  // Only retain the previous cache, not a chain of previous event indexes.
  const oldDays = previous?.days,
    oldWeeks = previous?.weeks;
  const keep = (map, key, value) => {
    map.set(key, value);
    if (map.size > 512) map.delete(map.keys().next().value);
    return value;
  };
  function day(number) {
    if (days.has(number)) return days.get(number);
    const date = dateForDay(number),
      next = dateForDay(number + 1),
      from = +date,
      to = +next;
    const first = bound(maxEnd, from + 1, (x) => x),
      last = bound(records, to, (r) => r.start);
    const all = [];
    for (let i = first; i < last; i++)
      if (records[i].end > from) all.push(records[i].event);
    // Match provider order for year dots and use stable event references to reuse
    // unaffected rows after a background chunk replaces a different date range.
    all.sort((a, b) => order.get(a) - order.get(b));
    const old = oldDays?.get(number);
    if (old && same(all, old.all)) return keep(days, number, old);
    return keep(days, number, makeBucket(number, date, all));
  }
  const order = new Map(events.map((e, i) => [e, i]));
  function week(number) {
    if (weeks.has(number)) return weeks.get(number);
    const buckets = Array.from({ length: 7 }, (_, i) => day(number + i));
    const old = oldWeeks?.get(number);
    if (old && same(buckets, old.days)) return keep(weeks, number, old);
    const ribbons = weekSegments(
      [...new Set(buckets.flatMap((d) => d.spanning))],
      dateForDay(number),
    );
    return keep(weeks, number, { number, days: buckets, ribbons });
  }
  function allDay(from, count) {
    return [
      ...new Set(
        Array.from({ length: count }, (_, i) =>
          day(from + i).all.filter((e) => e.allDay),
        ).flat(),
      ),
    ];
  }
  return { day, week, allDay, days, weeks, timeZone };
}

// Module-level factory keeps reused buckets independent of old indexes.
function makeBucket(number, date, all) {
  let timed, single, spanning, positioned;
  return {
    number,
    date,
    all,
    get timed() {
      return (timed ??= all.filter((e) => !e.allDay));
    },
    get single() {
      return (single ??= this.timed
        .filter((e) => {
          const r = metadata(e);
          return r.first === r.last;
        })
        .sort((a, b) => a.start.localeCompare(b.start)));
    },
    get spanning() {
      return (spanning ??= all.filter((e) => {
        const r = metadata(e);
        return e.allDay || r.first !== r.last;
      }));
    },
    get positioned() {
      return (positioned ??= layoutEvents(
        this.timed.map((e) => {
          const r = metadata(e);
          return {
            ...e,
            startMinute: r.first === number ? r.startMinute : 0,
            endMinute:
              calendarDay(new Date(r.end)) === number ? r.endMinute : 1440,
          };
        }),
      ));
    },
  };
}
