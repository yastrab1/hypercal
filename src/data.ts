import { addDays, startOfWeek, format } from "date-fns";
import type { Calendar, CalendarEvent, SavedView } from "./types";
export const demoCalendars: Calendar[] = [
  {
    id: "personal",
    name: "Personal",
    color: "#039be5",
    readOnly: false,
    source: "demo",
    primary: true,
  },
  {
    id: "school",
    name: "School timetable",
    color: "#0b8043",
    readOnly: false,
    source: "demo",
  },
  {
    id: "projects",
    name: "Projects",
    color: "#3f51b5",
    readOnly: false,
    source: "demo",
  },
  {
    id: "life",
    name: "Life & friends",
    color: "#d81b60",
    readOnly: false,
    source: "demo",
  },
];
export const initialViews: SavedView[] = [
  {
    id: "school-day",
    name: "School day",
    layout: "day",
    calendarIds: ["school"],
    include: "",
    exclude: "",
    hideAllDay: false,
  },
  {
    id: "monthly-highlights",
    name: "Monthly highlights",
    layout: "month",
    calendarIds: ["personal", "projects", "life"],
    include: "",
    exclude: "",
    hideAllDay: false,
  },
];
export function demoEvents(): CalendarEvent[] {
  const week = startOfWeek(new Date(), { weekStartsOn: 1 });
  const out: CalendarEvent[] = [];
  const add = (
    offset: number,
    hour: number,
    duration: number,
    title: string,
    calendarId: string,
    location = "",
    description = "",
  ) => {
    const start = addDays(week, offset);
    start.setHours(hour, 0, 0, 0);
    out.push({
      id: `sample-${out.length}`,
      calendarId,
      title,
      description,
      location,
      start: start.toISOString(),
      end: new Date(+start + duration * 3600000).toISOString(),
      allDay: false,
      readOnly: false,
      source: "demo",
    });
  };
  for (let w = -2; w <= 3; w++) {
    add(w * 7, 9, 1.5, "Linear algebra", "school", "Room B204");
    add(w * 7, 13, 1.5, "Programming lab", "school", "Computer lab 3");
    add(w * 7 + 1, 10, 1.5, "Physics lecture", "school", "Auditorium A");
    add(w * 7 + 1, 14, 1, "Project check-in", "projects", "Online");
    add(
      w * 7 + 2,
      9,
      1.5,
      "Algorithms & data structures",
      "school",
      "Room C102",
    );
    add(w * 7 + 2, 11, 1, "Coffee with Adam", "life", "Good Times Café");
    add(w * 7 + 2, 14, 2, "Deep work · HyperCal", "projects", "Library");
    add(w * 7 + 3, 9, 1.5, "Linear algebra", "school", "Room B204");
    add(w * 7 + 3, 13, 1.5, "Physics lab", "school", "Science building");
    add(w * 7 + 4, 10, 1.5, "Programming seminar", "school", "Room C102");
    add(w * 7 + 4, 17, 1.5, "Climbing with friends", "life", "Climbing gym");
    add(w * 7 + 5, 10, 1, "Slow Saturday", "personal");
  }
  const day = format(addDays(week, 4), "yyyy-MM-dd");
  out.push({
    id: "sample-deadline",
    calendarId: "projects",
    title: "Semester project due",
    description: "Submit the first milestone.",
    location: "",
    start: day,
    end: format(addDays(week, 5), "yyyy-MM-dd"),
    allDay: true,
    readOnly: false,
    source: "demo",
  });
  return out;
}
