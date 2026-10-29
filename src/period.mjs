import {
  addDays,
  addMonths,
  addYears,
  startOfMonth,
  startOfWeek,
  endOfMonth,
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
