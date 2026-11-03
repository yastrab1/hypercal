import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "date-fns";
import { createPrefetchGate } from "../src/prefetch-gate.mjs";
import { eventChunks, prefetchWindow } from "../src/event-stream.mjs";

function requested(date, layout) {
  const window = prefetchWindow(date, layout);
  return eventChunks(window.from, window.to).map((chunk) => chunk.key);
}

for (const layout of ["month", "week"]) {
  test(`${layout}: skip redundant updates without losing any required event chunk`, () => {
    const gate = createPrefetchGate(layout);
    let covered = new Set(), updates = 0, crossings = 0;
    // Both directions, a long fling, and a navigation jump across DST changes.
    const offsets = [
      ...Array.from({ length: 120 }, (_, i) => i * (layout === "month" ? 7 : 1)),
      ...Array.from({ length: 120 }, (_, i) => (119 - i) * (layout === "month" ? 7 : 1)),
      -500, 500,
    ];
    for (const offset of offsets) {
      const date = addDays(new Date(2026, 0, 5), offset);
      const chunks = requested(date, layout);
      if (gate(date)) {
        covered = new Set(chunks);
        updates++;
      }
      assert.ok(chunks.every((key) => covered.has(key)), `missing chunk at ${offset}`);
      if (++crossings === 120)
        assert.equal(updates, layout === "month" ? 61 : 9, "forward prefetch notifications");
    }
    assert.ok(updates < offsets.length / 1.8, `${updates} updates for ${offsets.length} crossings`);
  });
}

test("the first report and a jump request immediately, duplicate positions do not", () => {
  const gate = createPrefetchGate("month");
  const date = new Date(2026, 10, 1);
  assert.equal(gate(date), true);
  assert.equal(gate(new Date(+date)), false);
  assert.equal(gate(addDays(date, 365)), true);
});
