import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export function zonedInput(instant, zone) {
  return format(
    new TZDate(new Date(instant).getTime(), zone),
    "yyyy-MM-dd'T'HH:mm",
  );
}

export function eventInstant(day, time, zone, original) {
  const input = day + "T" + time;
  if (original && zonedInput(original, zone) === input)
    return new Date(original).toISOString();
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const instant = new TZDate(year, month - 1, date, hour, minute, zone);
  if (zonedInput(instant, zone) !== input)
    throw new Error(
      "That time does not exist in the selected time zone. Choose another time.",
    );
  return new Date(+instant).toISOString();
}
