import type { Calendar, CalendarEvent } from './types';
export const eventColors: {id:string;name:string;hex:string}[];
export function eventColor(event:CalendarEvent, calendars:Calendar[]): string;
export function googleColorFields(color?:string|null): object;
export function readEventColor(event:object): string|undefined;

export const defaultEventColors:{name:string;hex:string}[];
