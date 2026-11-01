// Some imported Google calendars return same-date all-day start/end values.
// Render these as one civil day while leaving the upstream event untouched.
export function normalizeAllDayRange(event) {
  if (
    !event?.allDay ||
    typeof event.start !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(event.start) ||
    event.end !== event.start
  )
    return event;
  const date = new Date(event.start + "T00:00:00Z");
  if (
    !Number.isFinite(+date) ||
    date.toISOString().slice(0, 10) !== event.start
  )
    return event;
  date.setUTCDate(date.getUTCDate() + 1);
  const end = date.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(end) ? { ...event, end } : event;
}
