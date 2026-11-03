import { eventChunks, prefetchWindow } from "./event-stream.mjs";

// Providers and disk caches load whole fortnight chunks. Moving the focus
// inside already requested chunks needs no parent render or cache lookup.
// Keep the larger coverage when a boundary-aligned window briefly shrinks.
export function createPrefetchGate(layout) {
  let from = Infinity,
    to = -Infinity;
  return (date) => {
    const window = prefetchWindow(date, layout);
    const chunks = eventChunks(window.from, window.to);
    const nextFrom = +chunks[0].from,
      nextTo = +chunks[chunks.length - 1].to;
    if (nextFrom >= from && nextTo <= to) return false;
    from = nextFrom;
    to = nextTo;
    return true;
  };
}
