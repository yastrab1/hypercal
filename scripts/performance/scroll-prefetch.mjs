import { addDays } from "date-fns";
import { createPrefetchGate } from "../../src/prefetch-gate.mjs";

// Count the parent updates scheduled by the viewport over the same deterministic
// row/day crossings. This is a work-count benchmark, not an FPS measurement.
const crossings = 120;
const anchor = new Date(2026, 0, 5);
const cases = ["month", "week"].map((layout) => {
  const gate = createPrefetchGate(layout);
  let after = 0;
  for (let i = 0; i < crossings; i++)
    after += Number(gate(addDays(anchor, i * (layout === "month" ? 7 : 1))));
  return {
    layout,
    crossings,
    beforeNotifications: crossings,
    afterNotifications: after,
    reduction: 1 - after / crossings,
  };
});
console.log(JSON.stringify({
  metric: "scheduled parent prefetch notifications",
  fixture: "120 forward week-row/month or day/week crossings from 2026-01-05",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  limitation: "Does not measure frame rate, render duration, or physical Android performance.",
  cases,
}, null, 2));
