import {
  addDays,
  addMonths,
  addYears,
  startOfMonth,
  startOfWeek,
  endOfMonth,
  startOfDay,
} from "date-fns";
export function shiftPeriod(date, layout, step) {
  return layout === "year"
    ? addYears(date, step)
    : layout === "month"
      ? addMonths(date, step)
      : addDays(date, step * (layout === "week" ? 7 : 1));
}

// End is exclusive, shared by rendering and fetching so the sixth row is loaded.
export function monthRange(date, mobile = false) {
  const from = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const to = mobile
    ? addDays(from, 42)
    : addDays(startOfWeek(endOfMonth(date), { weekStartsOn: 1 }), 7);
  return { from, to };
}

export function continuousRange(date, layout) {
  const anchor =
    layout === "month"
      ? startOfWeek(date, { weekStartsOn: 1 })
      : startOfDay(date);
  return {
    from: addDays(anchor, layout === "month" ? -70 : -14),
    to: addDays(anchor, layout === "month" ? 98 : 28),
  };
}
