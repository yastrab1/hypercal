import type { CalendarEvent, Layout } from "./types";
export interface EventChunk {
  from: Date;
  to: Date;
  key: string;
}
export interface PrefetchWindow {
  from: Date;
  to: Date;
  focus: Date;
}
export function eventChunks(from: Date, to: Date): EventChunk[];
export function prefetchWindow(first: Date, layout: Layout): PrefetchWindow;
export function mergeEventChunk(
  existing: CalendarEvent[],
  incoming: CalendarEvent[],
  from: Date,
  to: Date,
  ids: string[],
): CalendarEvent[];
export function createEventStream<T>(options: {
  load: (chunk: EventChunk) => Promise<T>;
  onChunk: (data: T, chunk: EventChunk, cached: boolean) => void;
  onPending?: (busy: boolean) => void;
  onError?: (error: Error) => void;
  readCache?: (chunk: EventChunk) => T | null | undefined;
  limit?: number;
}): { request: (window: PrefetchWindow) => void; close: () => void };
