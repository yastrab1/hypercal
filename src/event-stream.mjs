import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
} from "date-fns";
const epoch = new Date(1970, 0, 5);
export function eventChunks(from, to) {
  let day = addDays(
    epoch,
    Math.floor(differenceInCalendarDays(from, epoch) / 14) * 14,
  );
  const result = [];
  while (day < to) {
    const end = addDays(day, 14);
    result.push({
      from: day,
      to: end,
      key: `${format(day, "yyyy-MM-dd")}/${format(end, "yyyy-MM-dd")}`,
    });
    day = end;
  }
  return result;
}
export function prefetchWindow(first, layout) {
  const day = startOfDay(first);
  return {
    from: addDays(day, layout === "month" ? -14 : -7),
    to: addDays(day, layout === "month" ? 70 : 21),
    focus: addDays(day, layout === "month" ? 21 : 3),
  };
}
const timestamp = (value) =>
  new Date(value.length === 10 ? value + "T00:00:00" : value).getTime();
export function mergeEventChunk(existing, incoming, from, to, calendarIds) {
  const start = +from,
    end = +to,
    ids = new Set(calendarIds);
  const kept = existing.filter(
    (e) =>
      !ids.has(e.calendarId) ||
      timestamp(e.start) >= end ||
      timestamp(e.end) <= start,
  );
  return [
    ...new Map(
      [...kept, ...incoming].map((e) => [`${e.calendarId}:${e.id}`, e]),
    ).values(),
  ];
}
// Requests never gate the scroll position. Only two provider requests run at once.
export function createEventStream({
  load,
  onChunk,
  onPending,
  onError,
  readCache,
  limit = 2,
}) {
  let stopped = false,
    active = 0,
    queue = [],
    wanted = new Set();
  const loaded = new Set(),
    inflight = new Set(),
    cached = new Set();
  const pump = () => {
    while (!stopped && active < limit && queue.length) {
      const chunk = queue.shift();
      active++;
      inflight.add(chunk.key);
      onPending?.(true);
      Promise.resolve()
        .then(() => load(chunk))
        .then((data) => {
          if (stopped) return;
          loaded.add(chunk.key);
          onChunk(data, chunk, false);
        })
        .catch((error) => {
          if (!stopped) onError?.(error);
        })
        .finally(() => {
          active--;
          inflight.delete(chunk.key);
          if (!stopped) {
            pump();
            onPending?.(active > 0 || queue.length > 0);
          }
        });
    }
  };
  return {
    request({ from, to, focus }) {
      if (stopped) return;
      const chunks = eventChunks(from, to);
      wanted = new Set(chunks.map((c) => c.key));
      queue = queue.filter((c) => wanted.has(c.key));
      for (const chunk of chunks) {
        if (!cached.has(chunk.key)) {
          cached.add(chunk.key);
          const data = readCache?.(chunk);
          if (data) onChunk(data, chunk, true);
        }
        if (
          !loaded.has(chunk.key) &&
          !inflight.has(chunk.key) &&
          !queue.some((c) => c.key === chunk.key)
        )
          queue.push(chunk);
      }
      queue.sort(
        (a, b) =>
          Math.abs((+a.from + +a.to) / 2 - focus) -
          Math.abs((+b.from + +b.to) / 2 - focus),
      );
      pump();
    },
    close() {
      stopped = true;
      queue = [];
    },
  };
}
