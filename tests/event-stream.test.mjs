import test from "node:test";
import assert from "node:assert/strict";
import { addDays, differenceInCalendarDays } from "date-fns";
import {
  createEventStream,
  eventChunks,
  mergeEventChunk,
  prefetchWindow,
} from "../src/event-stream.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const anchor = new Date(2026, 9, 29);
test("stream prioritizes visible dates, displays cached data before network completion, and limits concurrency", async () => {
  const window = prefetchWindow(anchor, "month"),
    calls = [],
    deliveries = [],
    pending = [];
  let running = 0,
    max = 0;
  const stream = createEventStream({
    load: (chunk) =>
      new Promise((resolve) => {
        running++;
        max = Math.max(max, running);
        calls.push(chunk);
        pending.push(() => {
          running--;
          resolve({ events: [chunk.key] });
        });
      }),
    readCache: (chunk) => ({ events: ["cached:" + chunk.key] }),
    onChunk: (data, chunk, cached) => deliveries.push({ data, chunk, cached }),
  });
  stream.request(window);
  assert.ok(deliveries.length > 0);
  assert.ok(deliveries.every((d) => d.cached));
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(max, 2);
  const target = +window.focus;
  const distances = eventChunks(window.from, window.to)
    .map((c) => Math.abs((+c.from + +c.to) / 2 - target))
    .sort((a, b) => a - b);
  assert.equal(
    Math.abs((+calls[0].from + +calls[0].to) / 2 - target),
    distances[0],
  );
  pending.shift()();
  await tick();
  assert.equal(calls.length, 3);
  assert.equal(max, 2);
  assert.ok(deliveries.some((d) => !d.cached));
  stream.close();
  for (const finish of pending) finish();
  await tick();
});
test("fast scrolling replaces queued old requests and closing prevents late results crossing view/account boundaries", async () => {
  const calls = [],
    pending = [],
    delivered = [];
  const stream = createEventStream({
    load: (chunk) =>
      new Promise((resolve) => {
        calls.push(chunk);
        pending.push(() => resolve(chunk));
      }),
    onChunk: (data) => delivered.push(data),
  });
  stream.request(prefetchWindow(anchor, "month"));
  await tick();
  const next = prefetchWindow(addDays(anchor, 200), "month");
  stream.request(next);
  pending.shift()();
  await tick();
  assert.ok(calls[2].from >= next.from);
  const before = delivered.length;
  stream.close();
  for (const finish of pending) finish();
  await tick();
  assert.equal(delivered.length, before);
});
test("chunk merging preserves neighboring events and identities, updates changes and removes deleted events", () => {
  const from = new Date(2026, 9, 1),
    to = new Date(2026, 9, 15);
  const old = [
    {
      id: "same",
      calendarId: "a",
      start: "2026-10-05",
      end: "2026-10-06",
      title: "old",
    },
    { id: "same", calendarId: "b", start: "2026-10-05", end: "2026-10-06" },
    { id: "neighbor", calendarId: "a", start: "2026-10-20", end: "2026-10-21" },
    { id: "deleted", calendarId: "a", start: "2026-10-06", end: "2026-10-07" },
  ];
  const next = { ...old[0], title: "new" };
  const result = mergeEventChunk(old, [next], from, to, ["a"]);
  assert.equal(result.length, 3);
  assert.equal(
    result.find((e) => e.id === "same" && e.calendarId === "a").title,
    "new",
  );
  assert.ok(result.some((e) => e.calendarId === "b"));
  assert.ok(result.some((e) => e.id === "neighbor"));
  assert.ok(!result.some((e) => e.id === "deleted"));
});
test("chunks remain fourteen local calendar days across DST and cover the full prefetch window", () => {
  const from = new Date(2026, 2, 25),
    to = new Date(2026, 3, 20),
    chunks = eventChunks(from, to);
  assert.ok(chunks[0].from <= from);
  assert.ok(chunks.at(-1).to >= to);
  for (const chunk of chunks)
    assert.equal(differenceInCalendarDays(chunk.to, chunk.from), 14);
});
