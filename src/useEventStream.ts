import { useEffect, useRef, useState, startTransition } from "react";
import {
  createEventStream,
  type EventChunk,
  type PrefetchWindow,
} from "./event-stream.mjs";
import type { Calendar, CalendarEvent } from "./types";
export interface EventBatch {
  calendars?: Calendar[];
  events: CalendarEvent[];
  warnings: string[];
  refreshedAt?: string;
}
export function useEventStream({
  enabled,
  context,
  refresh,
  window,
  load,
  onChunk,
  readCache,
  writeCache,
}: {
  enabled: boolean;
  context: string;
  refresh: number;
  window: PrefetchWindow;
  load: (chunk: EventChunk, signal: AbortSignal) => Promise<EventBatch>;
  onChunk: (batch: EventBatch, chunk: EventChunk) => void;
  readCache?: (chunk: EventChunk) => EventBatch | null;
  writeCache?: (batch: EventBatch, chunk: EventChunk) => void;
}) {
  const latest = useRef({ load, onChunk, readCache, writeCache });
  latest.current = { load, onChunk, readCache, writeCache };
  const activeContext = useRef(context);
  activeContext.current = context;
  const requested = useRef(window);
  requested.current = window;
  const stream = useRef<ReturnType<
    typeof createEventStream<EventBatch>
  > | null>(null);
  const [state, setState] = useState({
    busy: false,
    error: "",
    warnings: [] as string[],
  });
  useEffect(() => {
    if (!enabled) {
      setState({ busy: false, error: "", warnings: [] });
      return;
    }
    setState({ busy: true, error: "", warnings: [] });
    const controller = new AbortController();
    const current = latest.current;
    let closed = false;
    const pendingWrites = new Set<() => void>();
    const loader = createEventStream<EventBatch>({
      load: (chunk) => current.load(chunk, controller.signal),
      readCache: (chunk) => current.readCache?.(chunk),
      onChunk: (batch, chunk, cached) => {
        startTransition(() => {
          if (!closed && activeContext.current === context)
            latest.current.onChunk(batch, chunk);
        });
        if (!cached) {
          setState((old) => ({ ...old, error: "", warnings: batch.warnings }));
          // Disk serialization stays off the wheel/pointer event path.
          let cancel: () => void;
          const write = () => {
            pendingWrites.delete(cancel);
            if (!closed && activeContext.current === context)
              current.writeCache?.(batch, chunk);
          };
          if (typeof requestIdleCallback === "function") {
            const id = requestIdleCallback(write, { timeout: 3000 });
            cancel = () => cancelIdleCallback(id);
          } else {
            const id = setTimeout(write, 500);
            cancel = () => clearTimeout(id);
          }
          pendingWrites.add(cancel);
        }
      },
      onPending: (busy) =>
        setState((old) => (old.busy === busy ? old : { ...old, busy })),
      onError: (error) => setState((old) => ({ ...old, error: error.message })),
    });
    stream.current = loader;
    loader.request(requested.current);
    return () => {
      closed = true;
      loader.close();
      controller.abort();
      for (const cancel of pendingWrites) cancel();
      stream.current = null;
    };
  }, [enabled, context, refresh]);
  useEffect(() => {
    stream.current?.request(window);
  }, [window.from.getTime(), window.to.getTime(), context, enabled, refresh]);
  return state;
}
