export type Layout = "day" | "week" | "month" | "year";
export interface Calendar {
  id: string;
  name: string;
  color: string;
  readOnly: boolean;
  source: "google" | "ical" | "demo";
  primary?: boolean;
}
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  readOnly: boolean;
  source: "google" | "ical" | "demo";
  timeZone?: string;
  reminderMinutes?: number | null;
  useDefaultReminders?: boolean;
  etag?: string;
  recurring?: boolean;
  htmlLink?: string;
}
export interface SavedView {
  isDefault?: boolean;
  id: string;
  name: string;
  layout: Layout;
  calendarIds: string[];
  include: string;
  exclude: string;
  hideAllDay: boolean;
}
export interface Session {
  connected: boolean;
  configured: boolean;
  user: { id: string; email: string } | null;
  csrf: string;
  appUrl: string;
}
