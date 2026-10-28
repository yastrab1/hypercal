import {
  differenceInCalendarDays,
  intervalToDuration,
  startOfDay,
} from "date-fns";
export function cleanTags(values = []) {
  return [
    ...new Set(
      values
        .filter((x) => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}
export function readEventTags(event) {
  try {
    return cleanTags(
      JSON.parse(event.extendedProperties?.shared?.hypercalTags || "[]"),
    );
  } catch {
    return [];
  }
}
export function countdown(target, now = new Date()) {
  const day = startOfDay(
    typeof target === "string" && target.length === 10
      ? new Date(target + "T00:00:00")
      : new Date(target),
  );
  const today = startOfDay(now);
  const days = differenceInCalendarDays(day, today);
  if (Math.abs(days) <= 30) return `${days}d`;
  const duration = intervalToDuration({
    start: days < 0 ? day : today,
    end: days < 0 ? today : day,
  });
  const months = (duration.years || 0) * 12 + (duration.months || 0);
  return `${days < 0 ? "−" : ""}${months}mo ${duration.days || 0}d`;
}
export function dayDistance(target, now = new Date()) {
  const days = differenceInCalendarDays(target, now);
  return days === 0
    ? "Today"
    : days === 1
      ? "1 day from today"
      : days === -1
        ? "1 day ago"
        : days > 0
          ? `${days} days from today`
          : `${-days} days ago`;
}
export function pillInk(color) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#131314"
    : "#f1f3f4";
}
export function highlightColor(color) {
  return (
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(color.slice(i, i + 2), 16) * 0.82 + 255 * 0.18)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
