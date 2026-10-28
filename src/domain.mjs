export function filterEvents(events, view, search = "") {
  const include = (view?.include || "")
    .toLowerCase()
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const exclude = (view?.exclude || "")
    .toLowerCase()
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return events.filter((e) => {
    if (view && !view.calendarIds.includes(e.calendarId)) return false;
    if (view?.hideAllDay && e.allDay) return false;
    const text =
      `${e.title} ${e.description || ""} ${e.location || ""}`.toLowerCase();
    return (
      (!include.length || include.some((x) => text.includes(x))) &&
      !exclude.some((x) => text.includes(x)) &&
      (!search || text.includes(search.toLowerCase()))
    );
  });
}
// Partition overlap groups, then assign the earliest free column within each group.
export function layoutEvents(events) {
  const sorted = events
    .map((e) => ({
      ...e,
      top: e.startMinute,
      bottom: Math.max(e.endMinute, e.startMinute + 25),
    }))
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const groups = [];
  let group = [],
    end = -1;
  for (const e of sorted) {
    if (e.top >= end && group.length) {
      groups.push(group);
      group = [];
      end = -1;
    }
    group.push(e);
    end = Math.max(end, e.bottom);
  }
  if (group.length) groups.push(group);
  return groups.flatMap((g) => {
    const columns = [];
    const placed = g.map((e) => {
      let col = columns.findIndex((end) => end <= e.top);
      if (col < 0) col = columns.length;
      columns[col] = e.bottom;
      return { ...e, column: col };
    });
    return placed.map((e) => ({ ...e, columns: columns.length }));
  });
}

function dateValue(value) {
  return value.length === 10 ? new Date(value + "T00:00:00") : new Date(value);
}
function dayNumber(date) {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
}
export function spansDays(event) {
  return (
    dayNumber(new Date(+dateValue(event.end) - 1)) >
    dayNumber(dateValue(event.start))
  );
}
// End dates are exclusive, including midnight timed ends. Use calendar days, not
// elapsed 24-hour periods, so ribbons stay aligned across daylight-saving changes.
export function weekSegments(events, start, dayCount = 7) {
  const first = dayNumber(start);
  const segments = events
    .map((event) => {
      const from = dayNumber(dateValue(event.start)) - first;
      const to = dayNumber(new Date(+dateValue(event.end) - 1)) - first + 1;
      return {
        event,
        start: Math.max(0, from),
        end: Math.min(dayCount, to),
        continuesBefore: from < 0,
        continuesAfter: to > dayCount,
      };
    })
    .filter((segment) => segment.end > segment.start)
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        `${a.event.calendarId}:${a.event.id}`.localeCompare(
          `${b.event.calendarId}:${b.event.id}`,
        ),
    );
  const lanes = [];
  return segments.map((segment) => {
    let lane = lanes.findIndex((end) => end <= segment.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = segment.end;
    return { ...segment, lane };
  });
}

export function getDefaultView(views, layout) {
  return views.find((view) => view.layout === layout && view.isDefault) || null;
}
export function assignLayoutDefault(views, layout, id) {
  return views.map((view) =>
    view.layout === layout ? { ...view, isDefault: view.id === id } : view,
  );
}
