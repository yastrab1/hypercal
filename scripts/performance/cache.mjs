import { performance } from "node:perf_hooks";
import { createCalendarCache as current } from "../../src/cache.mjs";
import { createCalendarCache as baseline } from "../../artifacts/performance/baseline-source/src/cache.mjs";
const result = [];
for (const [name, create] of [
  ["baseline", baseline],
  ["current", current],
]) {
  const values = new Map(),
    storage = {
      get length() {
        return values.size;
      },
      key: (i) => [...values.keys()][i],
      getItem: (k) => values.get(k) || null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    };
  const cache = create(storage),
    user = { id: "fixture", email: "fixture@example.test" };
  cache.writeMetadata(user, [], []);
  for (let i = 0; i < 6; i++)
    cache.writeRange(
      user,
      String(i),
      Array.from({ length: 1000 }, (_, n) => ({
        id: `${i}-${n}`,
        calendarId: "c",
        title: `Synthetic event ${n}`,
        start: "2026-10-29T08:00:00Z",
        end: "2026-10-29T09:00:00Z",
        description: "Synthetic cached event",
      })),
      "now",
    );
  const samples = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    for (let n = 0; n < 100; n++) cache.readRange(user.id, String(n % 6));
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  result.push({
    name,
    reads: 100,
    storedEvents: 6000,
    medianMs: samples[2],
    samples,
  });
}
console.log(JSON.stringify(result, null, 2));
