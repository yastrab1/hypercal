import type { Calendar } from "./types";
export interface QuickDate {
  from: number;
  to: number;
  phrase: string;
  date: string;
}
export function parseQuickDate(text: string, now?: Date): QuickDate | null;
export function withoutDatePhrase(
  text: string,
  match: QuickDate | null,
): string;
export function findCalendars(calendars: Calendar[], query: string): Calendar[];
export function calendarMention(
  text: string,
  caret: number,
): { from: number; to: number; query: string } | null;
