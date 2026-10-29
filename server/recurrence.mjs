import ICAL from "ical.js";
import { copiedEventBody } from "./copy-event.mjs";
const instant = (t) => new Date(t.dateTime || t.date + "T00:00:00Z");
const compact = (d) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
function wall(value, zone) {
  if (value.date) return value.date + "T00:00:00";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant(value))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
function fromWall(value, zone) {
  const target = Date.parse(value + "Z");
  let guess = target;
  for (let i = 0; i < 5; i++) {
    const actual = Date.parse(
      wall({ dateTime: new Date(guess).toISOString() }, zone) + "Z",
    );
    const delta = target - actual;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}
export function shiftSeriesTime(base, source, desired, zone) {
  const delta =
    Date.parse(wall(desired, zone) + "Z") -
    Date.parse(wall(source, zone) + "Z");
  const next = new Date(Date.parse(wall(base, zone) + "Z") + delta)
    .toISOString()
    .slice(0, 19);
  return desired.date
    ? { date: next.slice(0, 10) }
    : { dateTime: fromWall(next, zone), timeZone: zone };
}
export function splitRules(master, originalStart) {
  const zone = master.start.timeZone || originalStart.timeZone || "UTC";
  const boundary = wall(originalStart, zone),
    begin = wall(master.start, zone);
  if (boundary <= begin)
    return { first: true, before: [], after: master.recurrence };
  const until = master.start.date
    ? compact(new Date(instant(originalStart) - 86400000)).slice(0, 8)
    : compact(new Date(instant(originalStart) - 1000));
  const before = [],
    after = [];
  for (const line of master.recurrence || []) {
    if (line.startsWith("RRULE:")) {
      const rule = ICAL.Recur.fromString(line.slice(6));
      let n = 0,
        next;
      const iter = rule.iterator(
        ICAL.Time.fromString(master.start.date || begin),
      );
      while (
        (next = iter.next()) &&
        (next.isDate ? next.toString() + "T00:00:00" : next.toString()) <
          boundary
      ) {
        if (++n > 100000)
          throw Object.assign(
            new Error("This series is too long to split safely."),
            { status: 400, expose: true },
          );
      }
      const parts = line.slice(6).split(";");
      const trim = parts.filter(
        (p) => !p.startsWith("COUNT=") && !p.startsWith("UNTIL="),
      );
      if (n) before.push("RRULE:" + trim.concat("UNTIL=" + until).join(";"));
      if (next) {
        const count = parts.find((p) => p.startsWith("COUNT="));
        after.push(
          "RRULE:" +
            parts
              .filter((p) => !p.startsWith("COUNT="))
              .concat(count ? ["COUNT=" + (Number(count.slice(6)) - n)] : [])
              .join(";"),
        );
      }
    } else if (/^(RDATE|EXDATE)[;:]/.test(line)) {
      const colon = line.indexOf(":"),
        prefix = line.slice(0, colon + 1),
        dates = line.slice(colon + 1).split(",");
      const side = (value) => {
        const expanded =
          value.length === 8
            ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
            : `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}${value.endsWith("Z") ? "Z" : ""}`;
        return expanded.endsWith("Z")
          ? wall({ dateTime: expanded }, zone)
          : expanded.length === 10
            ? expanded + "T00:00:00"
            : expanded;
      };
      const earlier = dates.filter((d) => side(d) < boundary),
        later = dates.filter((d) => side(d) >= boundary);
      if (earlier.length) before.push(prefix + earlier.join(","));
      if (later.length) after.push(prefix + later.join(","));
    } else
      throw Object.assign(
        new Error("This recurrence rule cannot be split safely."),
        { status: 400, expose: true },
      );
  }
  if (!after.length)
    throw Object.assign(
      new Error("This occurrence is outside the remaining recurrence rule."),
      { status: 400, expose: true },
    );
  return { first: false, before, after };
}
export async function changeRecurring({
  id,
  calendarId,
  eventId,
  etag,
  scope = "instance",
  draft,
  body,
  normalize,
  request,
  cache,
  remove = false,
}) {
  const path = `calendars/${encodeURIComponent(calendarId)}/events`;
  const source = await request(id, `${path}/${encodeURIComponent(eventId)}`);
  if (etag !== source.etag)
    throw Object.assign(
      new Error(
        "This event changed in Google Calendar. Refresh before editing.",
      ),
      { status: 412 },
    );
  const seriesId =
    source.recurringEventId || (source.recurrence?.length ? source.id : null);
  const patch = (target, data) =>
    request(id, `${path}/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      etag: target.etag,
      body: data,
    });
  const del = (target) =>
    request(id, `${path}/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
      etag: target.etag,
    });
  const remember = (result) => {
    cache.remember(
      id,
      [
        normalize(result, {
          id: calendarId,
          accessRole: "writer",
          _hypercalAccountId: id,
        }),
      ],
      { local: true },
    );
    return result;
  };
  if (!seriesId || scope === "instance") {
    if (remove) {
      await del(source);
      cache.remove(id, calendarId, eventId);
      return { ok: true };
    }
    return remember(await patch(source, body(draft, source)));
  }
  const master =
    source.id === seriesId
      ? source
      : await request(id, `${path}/${encodeURIComponent(seriesId)}`);
  if (!master.recurrence?.length)
    throw Object.assign(
      new Error("The recurring series is no longer available."),
      { status: 409, expose: true },
    );
  const boundary = source.originalStartTime || source.start;
  const split = scope === "following" ? splitRules(master, boundary) : null;
  const all = scope === "all" || split?.first;
  const affected = cache
    .events(id)
    .filter(
      (e) =>
        e.calendarId === calendarId &&
        (e.recurringEventId === seriesId || e.id === seriesId) &&
        (all ||
          new Date(
            e.originalStartTime?.dateTime ||
              e.originalStartTime?.date ||
              e.start,
          ) >= instant(boundary)),
    );
  if (remove) {
    if (all) await del(master);
    else await patch(master, { recurrence: split.before });
    for (const e of affected) cache.remove(id, calendarId, e.id);
    return { ok: true };
  }
  const changes = body(draft, master, source);
  const desired = body(draft, source);
  const zone = master.start.timeZone || draft.timeZone || "UTC";
  if (changes.start && all)
    changes.recurrence = shiftWeekdays(
      master.recurrence,
      source.start,
      desired.start,
      zone,
    );
  if (all) {
    const result = await patch(master, changes);
    for (const e of affected) cache.forget?.(id, calendarId, e.id);
    try {
      const query = new URLSearchParams({
        timeMin: new Date().toISOString(),
        maxResults: "2",
      });
      const instances = await request(
        id,
        `${path}/${encodeURIComponent(seriesId)}/instances?${query}`,
      );
      for (const instance of instances.items || []) remember(instance);
    } catch {
      /* Provider refresh will populate the updated series on its next pass. */
    }
    return result;
  }
  // Create first, then trim the old series. If trimming fails, remove the new
  // series; the original stays intact, avoiding a lost future schedule.
  const copy = copiedEventBody(master);
  for (const key of [
    "attendees",
    "guestsCanModify",
    "guestsCanInviteOthers",
    "guestsCanSeeOtherGuests",
    "conferenceData",
    "attachments",
  ])
    if (master[key] !== undefined) copy[key] = structuredClone(master[key]);
  const newBody = {
    ...copy,
    ...changes,
    start: body(draft, source).start,
    end: body(draft, source).end,
    recurrence: shiftWeekdays(split.after, source.start, desired.start, zone),
  };
  newBody.extendedProperties = {
    private: {
      ...master.extendedProperties?.private,
      ...changes.extendedProperties?.private,
    },
    shared: {
      ...master.extendedProperties?.shared,
      ...changes.extendedProperties?.shared,
    },
  };
  const created = await request(id, path, { method: "POST", body: newBody });
  try {
    await patch(master, { recurrence: split.before });
  } catch (error) {
    try {
      await del(created);
    } catch {
      throw Object.assign(
        new Error(
          "The original series is unchanged, but a duplicate future series may remain. Refresh and review before retrying.",
        ),
        { status: 502, expose: true },
      );
    }
    throw error;
  }
  for (const e of affected) cache.remove(id, calendarId, e.id);
  return remember(created);
}
// Explicit weekday constraints must move with a rescheduled weekly series.
export function shiftWeekdays(rules, source, desired, zone) {
  const a = wall(source, zone).slice(0, 10),
    b = wall(desired, zone).slice(0, 10);
  const days = Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000,
  );
  if (!days) return rules;
  const week = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return rules.map((rule) =>
    rule.startsWith("RRULE:")
      ? rule.replace(
          /BYDAY=([^;]+)/,
          (_, values) =>
            "BYDAY=" +
            values
              .split(",")
              .map((day) =>
                day.replace(
                  /(SU|MO|TU|WE|TH|FR|SA)$/,
                  (value) => week[(((week.indexOf(value) + days) % 7) + 7) % 7],
                ),
              )
              .join(","),
        )
      : rule,
  );
}
