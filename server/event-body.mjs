import { googleColorFields, readEventColor } from "../src/event-colors.mjs";
import { googleTagFields, readEventTags } from "./tags.mjs";
import { shiftSeriesTime } from "./recurrence.mjs";
export function eventBody(e) {
  const time = e.allDay
    ? { start: { date: e.start }, end: { date: e.end } }
    : {
        start: {
          dateTime: e.start,
          timeZone:
            e.timeZone || process.env.CALENDAR_TIMEZONE || "Europe/Prague",
        },
        end: {
          dateTime: e.end,
          timeZone:
            e.timeZone || process.env.CALENDAR_TIMEZONE || "Europe/Prague",
        },
      };
  return {
    ...googleColorFields(e.color),
    extendedProperties: {
      ...googleColorFields(e.color).extendedProperties,
      ...googleTagFields(e.tags, e.previousTags),
    },
    summary: e.title,
    description: e.description,
    location: e.location,
    ...time,
    ...(e.useDefaultReminders
      ? { reminders: { useDefault: true } }
      : e.reminderMinutes !== undefined
        ? {
            reminders: {
              useDefault: false,
              overrides:
                e.reminderMinutes === null
                  ? []
                  : [{ method: "popup", minutes: e.reminderMinutes }],
            },
          }
        : {}),
    ...(e.recurrence && e.recurrence !== "none"
      ? { recurrence: [`RRULE:FREQ=${e.recurrence.toUpperCase()}`] }
      : {}),
  };
}
export function scopedEventBody(draft, target, occurrence) {
  const full = eventBody({ ...draft, previousTags: readEventTags(target) });
  if (!occurrence) return full;
  const prior = {
    title: occurrence.summary || "Untitled event",
    description: occurrence.description || "",
    location: occurrence.location || "",
    color: readEventColor(occurrence),
    tags: readEventTags(occurrence),
    allDay: !!occurrence.start.date,
    start: occurrence.start.dateTime || occurrence.start.date,
    end: occurrence.end.dateTime || occurrence.end.date,
  };
  const changes = {};
  for (const [field, key] of [
    ["title", "summary"],
    ["description", "description"],
    ["location", "location"],
  ])
    if (draft[field] !== prior[field]) changes[key] = full[key];
  const properties = {};
  if (
    draft.color !== undefined &&
    (draft.color || null) !== (prior.color || null)
  ) {
    const fields = googleColorFields(draft.color);
    changes.colorId = fields.colorId;
    properties.private = fields.extendedProperties.private;
  }
  if (
    draft.tags !== undefined &&
    JSON.stringify(draft.tags) !== JSON.stringify(prior.tags)
  )
    properties.shared = googleTagFields(
      draft.tags,
      readEventTags(target),
    ).shared;
  if (Object.keys(properties).length) changes.extendedProperties = properties;
  if (full.reminders) changes.reminders = full.reminders;
  if (
    draft.allDay !== prior.allDay ||
    new Date(draft.start).getTime() !== new Date(prior.start).getTime() ||
    new Date(draft.end).getTime() !== new Date(prior.end).getTime()
  ) {
    const zone = target.start.timeZone || draft.timeZone || "Europe/Prague";
    changes.start = shiftSeriesTime(
      target.start,
      occurrence.start,
      full.start,
      zone,
    );
    changes.end = shiftSeriesTime(target.end, occurrence.end, full.end, zone);
  }
  return changes;
}
