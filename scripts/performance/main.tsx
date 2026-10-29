import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { addDays, addMonths, startOfWeek, startOfMonth } from "date-fns";
import { CalendarCanvas } from "../../src/Calendar";
import { monthRange } from "../../src/period.mjs";
import type { Calendar, CalendarEvent, Layout } from "../../src/types";
import "../../src/style.css";

// Production React, deterministic data, same hardware and viewport before/after.
// Measures synchronous render + commit + forced layout, not provider latency.
const style = document.createElement("style");
style.textContent =
  "body{overflow:auto}#controls{padding:12px}#controls h1{font-size:18px}#controls button{padding:10px}#stage{width:100%;height:750px;overflow:hidden;position:relative;background:var(--paper)}#results{white-space:pre-wrap;padding:12px}";
document.head.append(style);
const stage = document.getElementById("stage")!;
const root = createRoot(stage);
const count = Number(
  new URLSearchParams(location.search).get("events") || 6000,
);
const epoch = new Date(2026, 0, 1);
const calendars: Calendar[] = Array.from({ length: 12 }, (_, i) => ({
  id: `c${i}`,
  name: `Calendar ${i}`,
  color: ["#489160", "#4b99d2", "#a479b1"][i % 3],
  source: "google",
  readOnly: false,
}));
const events: CalendarEvent[] = Array.from({ length: count }, (_, i) => {
  const day = addDays(epoch, i % 365),
    allDay = i % 17 === 0;
  day.setHours(7 + (Math.floor(i / 365) % 12), (i % 4) * 15, 0, 0);
  const end = allDay ? addDays(day, 1 + (i % 4)) : new Date(+day + 45 * 60000);
  const dateOnly = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    id: `event-${i}`,
    calendarId: `c${i % 12}`,
    title: `Event ${i}`,
    start: allDay ? dateOnly(day) : day.toISOString(),
    end: allDay ? dateOnly(end) : end.toISOString(),
    allDay,
    description: "Synthetic benchmark fixture",
    location: i % 3 ? "" : "Room B204",
  };
});
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const noop = () => {};
const cases: [string, Layout, boolean][] = [
  ["day", "day", false],
  ["month", "month", false],
  ["continuous-month", "month", true],
  ["week", "week", false],
  ["continuous-week", "week", true],
  ["year-sync", "year", false],
];
document.getElementById("run")!.addEventListener("click", async () => {
  const button = document.getElementById("run") as HTMLButtonElement;
  button.disabled = true;
  const results: any = {
    viewport: { width: innerWidth, height: innerHeight },
    events: count,
    metric: "synchronous render + commit + forced layout milliseconds",
    cases: [],
  };
  for (const [name, layout, continuous] of cases) {
    document.getElementById("status")!.textContent = `Running ${name}`;
    stage.className = continuous ? `continuous-${layout}` : "";
    const anchor = new Date(2026, 8, 7);
    let previousBatch = -1,
      cachedData: CalendarEvent[] = [];
    const samples: number[] = [];
    for (
      let n = -(layout === "year" ? 1 : 3);
      n < (layout === "year" ? 5 : 12);
      n++
    ) {
      const step = n + 3;
      const date =
        layout === "month" && !continuous
          ? addMonths(anchor, (step % 6) - 3)
          : addDays(
              anchor,
              step *
                (layout === "month"
                  ? 7
                  : layout === "week" && !continuous
                    ? 7
                    : layout === "year"
                      ? 0
                      : 1),
            );
      const first = startOfWeek(date, { weekStartsOn: 1 });
      stage.style.height =
        continuous && layout === "month" ? "2250px" : "750px";
      stage.style.width =
        continuous && layout === "week" ? `${innerWidth * 3}px` : "100%";
      const range =
        layout === "year"
          ? { from: epoch, to: new Date(2027, 0, 1) }
          : continuous
            ? {
                from: addDays(anchor, layout === "month" ? -42 : -14),
                to: addDays(
                  anchor,
                  layout === "month"
                    ? Math.floor(step / 2) * 14 + 84
                    : Math.floor(step / 7) * 7 + 28,
                ),
              }
            : layout === "month"
              ? monthRange(date, innerWidth <= 760)
              : {
                  from: layout === "week" ? first : date,
                  to: addDays(
                    layout === "week" ? first : date,
                    layout === "week" ? 7 : 1,
                  ),
                };
      const batch = continuous
        ? Math.floor(step / (layout === "month" ? 2 : 7))
        : step;
      if (batch !== previousBatch) {
        cachedData = events.filter(
          (e) => new Date(e.start) < range.to && new Date(e.end) > range.from,
        );
        previousBatch = batch;
      }
      const data = cachedData;
      const renderData =
        layout === "year"
          ? data.map((e, i) =>
              i === step % data.length ? { ...e, title: `Updated ${n}` } : e,
            )
          : continuous
            ? data
            : data.map((e) => ({ ...e }));
      const start = performance.now();
      flushSync(() =>
        root.render(
          <CalendarCanvas
            key={name}
            layout={layout}
            date={date}
            events={renderData}
            calendars={calendars}
            monthWindow={
              continuous && layout === "month"
                ? { start: first, weeks: 18 }
                : undefined
            }
            weekWindow={
              continuous && layout === "week"
                ? { start: date, days: 21 }
                : undefined
            }
            onCreate={noop}
            onEvent={noop}
            onDate={noop}
            onExpandDay={noop}
          />,
        ),
      );
      stage.getBoundingClientRect();
      const elapsed = performance.now() - start;
      if (n >= 0) samples.push(elapsed);
      await frame();
      await frame();
    }
    results.cases.push({
      name,
      medianMs: median(samples),
      p95Ms: [...samples].sort((a, b) => a - b)[
        Math.floor(samples.length * 0.95)
      ],
      samples,
    });
  }
  flushSync(() => root.render(null));
  stage.style.height = "0";
  document.getElementById("results")!.textContent = JSON.stringify(
    results,
    null,
    2,
  );
  document.getElementById("status")!.textContent = "Complete";
  button.disabled = false;
});
