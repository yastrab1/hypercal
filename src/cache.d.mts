import type { Calendar, CalendarEvent, SavedView, Session } from "./types";
type User = NonNullable<Session["user"]>;
export interface CachedRange {
  events: CalendarEvent[];
  refreshedAt: string;
  savedAt: number;
}
export interface CachedAccount {
  user: User;
  calendars: Calendar[];
  views: SavedView[];
  ranges: Record<string, CachedRange>;
  updatedAt: number;
}
export function createCalendarCache(
  storage: Storage,
  now?: () => number,
): {
  readAccount: (id: string) => CachedAccount | null;
  readLast: () => CachedAccount | null;
  writeMetadata: (
    user: User,
    calendars: Calendar[],
    views: SavedView[],
  ) => void;
  readRange: (id: string, key: string) => CachedRange | null;
  writeRange: (
    user: User,
    key: string,
    events: CalendarEvent[],
    refreshedAt: string,
  ) => void;
  invalidateEvents: (id: string) => void;
  forget: () => void;
};
