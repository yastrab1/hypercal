import type { CalendarEvent } from "./types";
export function calendarDay(date: Date): number;
export function dateForDay(day: number): Date;
export interface CalendarDayBucket {
  number: number;
  date: Date;
  all: CalendarEvent[];
  timed: CalendarEvent[];
  single: CalendarEvent[];
  spanning: CalendarEvent[];
  positioned: (CalendarEvent & {
    top: number;
    bottom: number;
    column: number;
    columns: number;
  })[];
}
export interface CalendarWeekBucket {
  number: number;
  days: CalendarDayBucket[];
  ribbons: {
    event: CalendarEvent;
    start: number;
    end: number;
    lane: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
  }[];
}
export interface CalendarIndex {
  day(day: number): CalendarDayBucket;
  week(day: number): CalendarWeekBucket;
  allDay(from: number, count: number): CalendarEvent[];
  days: Map<number, CalendarDayBucket>;
  weeks: Map<number, CalendarWeekBucket>;
  timeZone: string;
}
export function createCalendarIndex(
  events: CalendarEvent[],
  previous?: CalendarIndex,
  timeZone?: string,
): CalendarIndex;
