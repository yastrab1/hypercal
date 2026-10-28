import type { CalendarEvent, SavedView } from "./types";
export function filterEvents(
  events: CalendarEvent[],
  view?: SavedView | null,
  search?: string,
): CalendarEvent[];
export function layoutEvents<
  T extends { startMinute: number; endMinute: number },
>(
  events: T[],
): (T & { top: number; bottom: number; column: number; columns: number })[];
export function spansDays(event: CalendarEvent): boolean;
export function weekSegments(
  events: CalendarEvent[],
  start: Date,
  dayCount?: number,
): {
  event: CalendarEvent;
  start: number;
  end: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}[];
export function getDefaultView(
  views: SavedView[],
  layout: import("./types").Layout,
): SavedView | null;
export function assignLayoutDefault(
  views: SavedView[],
  layout: import("./types").Layout,
  id: string | null,
): SavedView[];
