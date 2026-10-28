import { addDays, addMonths, addYears } from "date-fns";
export function shiftPeriod(date, layout, step) {
  return layout === "year"
    ? addYears(date, step)
    : layout === "month"
      ? addMonths(date, step)
      : addDays(date, step * (layout === "week" ? 7 : 1));
}
