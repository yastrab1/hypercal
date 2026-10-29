import { monthRange } from "./period.mjs";
import { eventColor } from "./event-colors.mjs";
import { useEffect, useRef, useState } from "react";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  differenceInCalendarDays,
} from "date-fns";
import type { Calendar, CalendarEvent, Layout } from "./types";
import { layoutEvents, spansDays, weekSegments } from "./domain.mjs";
export function eventDate(value: string) {
  return value.length === 10 ? new Date(value + "T00:00:00") : new Date(value);
}
export function onDay(e: CalendarEvent, date: Date) {
  const from = startOfDay(date);
  const to = addDays(from, 1);
  return eventDate(e.start) < to && eventDate(e.end) > from;
}
export function CalendarCanvas({
  layout,
  date,
  events,
  calendars,
  onEvent,
  onEdit,
  onCreate,
  onDate,
  onExpandDay,
  readOnly = false,
}: {
  onEdit?: (event: CalendarEvent) => void;
  readOnly?: boolean;
  layout: Layout;
  date: Date;
  events: CalendarEvent[];
  calendars: Calendar[];
  onEvent: (e: CalendarEvent, anchor: HTMLElement) => void;
  onCreate: (d: Date) => void;
  onDate: (d: Date, layout?: Layout) => void;
  onExpandDay: (date: Date, anchor: HTMLElement) => void;
}) {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const edit = (event: CalendarEvent, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!readOnly && !event.readOnly) onEdit?.(event);
  };
  const scroll = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLDivElement>(null);
  const [monthHeight, setMonthHeight] = useState(600);
  useEffect(() => {
    const el = monthRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setMonthHeight(entries[0].contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * 64;
  }, [layout]);
  const color = (e: CalendarEvent) => eventColor(e, calendars);
  const eventButton = (e: CalendarEvent, compact = false) => (
    <button
      key={`${e.calendarId}:${e.id}`}
      className={`event-chip ${compact ? "compact" : ""} ${e.allDay ? "all-day" : ""}`}
      style={{ "--event-color": color(e) } as React.CSSProperties}
      onClick={(ev) => {
        ev.stopPropagation();
        onEvent(e, ev.currentTarget);
      }}
      onDoubleClick={(ev) => edit(e, ev)}
      title={`${e.title}${e.location ? " · " + e.location : ""}`}
    >
      <span className="event-dot" />
      {!e.allDay && <time>{format(eventDate(e.start), "HH:mm")}</time>}
      <span>{e.title}</span>
    </button>
  );
  if (layout === "year")
    return (
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, m) => {
          const month = new Date(date.getFullYear(), m, 1);
          const begin = startOfWeek(month, { weekStartsOn: 1 });
          return (
            <section key={m} className="mini-month">
              <button
                className="month-title"
                onClick={() => onDate(month, "month")}
              >
                {format(month, "MMMM")}
              </button>
              <div className="mini-grid">
                {["M", "T", "W", "T", "F", "S", "S"].map((x, i) => (
                  <span key={"h" + i} className="mini-weekday">
                    {x}
                  </span>
                ))}
                {Array.from(
                  {
                    length:
                      35 +
                      (differenceInCalendarDays(endOfMonth(month), begin) > 34
                        ? 7
                        : 0),
                  },
                  (_, i) => {
                    const day = addDays(begin, i);
                    const es = events.filter((e) => onDay(e, day));
                    return (
                      <button
                        key={i}
                        disabled={!isSameMonth(day, month)}
                        className={`${isSameDay(day, new Date()) ? "today " : ""}${es.length ? "has-events" : ""}`}
                        onClick={() => onDate(day, "day")}
                        aria-label={`${format(day, "EEEE, MMMM d")}, ${es.length} events`}
                      >
                        {format(day, "d")}
                        {es.length > 0 && (
                          <i style={{ background: color(es[0]) }} />
                        )}
                      </button>
                    );
                  },
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  if (layout === "month") {
    const { from: begin, to } = monthRange(date, mobile);
    const days = eachDayOfInterval({ start: begin, end: addDays(to, -1) });
    return (
      <div className="month-view" ref={monthRef}>
        <div className="month-weekdays">
          {[
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ].map((d) => (
            <span key={d}>{d.slice(0, 3)}</span>
          ))}
        </div>
        <div
          className="month-grid connected-month"
          style={{
            gridTemplateRows: `repeat(${days.length / 7}, minmax(0,1fr))`,
          }}
        >
          {Array.from({ length: days.length / 7 }, (_, week) => {
            const weekDays = days.slice(week * 7, week * 7 + 7);
            const ribbons = weekSegments(
              events.filter((e) => e.allDay || spansDays(e)),
              weekDays[0],
            );
            const lanes = ribbons.reduce((n, s) => Math.max(n, s.lane + 1), 0);
            const compact = window.innerWidth <= 760;
            const capacity = Math.max(
              1,
              Math.floor(
                ((monthHeight - 36) / (days.length / 7) -
                  (compact ? 27 : 32) -
                  18) /
                  (compact ? 16 : 22),
              ),
            );
            const visibleLanes = Math.min(lanes, capacity);
            return (
              <div
                className="month-week"
                key={weekDays[0].toISOString()}
                style={
                  { "--ribbon-lanes": visibleLanes } as React.CSSProperties
                }
              >
                {weekDays.map((day) => {
                  const es = events
                    .filter((e) => !e.allDay && !spansDays(e) && onDay(e, day))
                    .sort((a, b) => a.start.localeCompare(b.start));
                  const remaining = Math.max(0, capacity - visibleLanes);
                  const hidden =
                    ribbons.filter(
                      (segment) =>
                        segment.lane >= visibleLanes &&
                        weekDays.indexOf(day) >= segment.start &&
                        weekDays.indexOf(day) < segment.end,
                    ).length + Math.max(0, es.length - remaining);
                  return (
                    <div
                      key={day.toISOString()}
                      className={`month-cell ${!isSameMonth(day, date) ? "outside" : ""}`}
                      onClick={(ev) => {
                        if (!(ev.target as HTMLElement).closest("button"))
                          onDate(day, "day");
                      }}
                    >
                      <button
                        className={`date-number ${isSameDay(day, new Date()) ? "today" : ""}`}
                        onClick={(e) => onExpandDay(day, e.currentTarget)}
                        aria-label={`Events and countdown for ${format(day, "MMMM d")}`}
                      >
                        {format(day, "d")}
                      </button>
                      <button
                        disabled={readOnly}
                        className="cell-create"
                        aria-label={`Create event on ${format(day, "MMMM d")}`}
                        onClick={() => onCreate(day)}
                      >
                        +
                      </button>
                      <div
                        className="month-events"
                        style={{
                          paddingTop: `calc(${visibleLanes} * var(--ribbon-step))`,
                        }}
                      >
                        {es
                          .slice(0, remaining)
                          .map((e) => eventButton(e, true))}
                        {hidden > 0 && (
                          <button
                            className="more-events"
                            aria-label={`Show all events on ${format(day, "MMMM d")}`}
                            onClick={(ev) =>
                              onExpandDay(
                                day,
                                ev.currentTarget.closest(
                                  ".month-cell",
                                ) as HTMLElement,
                              )
                            }
                          >
                            +{hidden} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div
                  className="ribbon-layer"
                  style={{
                    gridTemplateRows: `repeat(${visibleLanes},var(--ribbon-height))`,
                  }}
                >
                  {ribbons
                    .filter((segment) => segment.lane < visibleLanes)
                    .map((segment) => (
                      <button
                        key={`${segment.event.calendarId}:${segment.event.id}`}
                        className={`calendar-ribbon ${segment.continuesBefore ? "continues-before" : ""} ${segment.continuesAfter ? "continues-after" : ""}`}
                        style={
                          {
                            gridColumn: `${segment.start + 1} / ${segment.end + 1}`,
                            gridRow: segment.lane + 1,
                            "--event-color": color(segment.event),
                          } as React.CSSProperties
                        }
                        onClick={(ev) =>
                          onEvent(segment.event, ev.currentTarget)
                        }
                        onDoubleClick={(ev) => edit(segment.event, ev)}
                        aria-label={`${segment.event.title}, ${format(eventDate(segment.event.start), "MMM d")} to ${format(new Date(+eventDate(segment.event.end) - 1), "MMM d")}`}
                      >
                        <span>
                          {!segment.event.allDay &&
                            `${format(eventDate(segment.event.start), "HH:mm")} `}
                          {segment.event.title}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  const days =
    layout === "day"
      ? [date]
      : Array.from({ length: 7 }, (_, i) =>
          addDays(startOfWeek(date, { weekStartsOn: 1 }), i),
        );
  return (
    <div
      className={`time-calendar time-${layout}`}
      style={{ "--days": days.length } as React.CSSProperties}
    >
      <div className="day-heading">
        <div className="timezone-label">
          GMT{format(date, "xxx").slice(0, 3)}
        </div>
        {days.map((d) => (
          <button
            key={d.toISOString()}
            className={`day-label ${isSameDay(d, new Date()) ? "current" : ""}`}
            onClick={(e) => onExpandDay(d, e.currentTarget)}
          >
            <span>{format(d, "EEE")}</span>
            <strong>{format(d, "d")}</strong>
          </button>
        ))}
      </div>
      <div className="all-day-connected">
        <span>all-day</span>
        <div
          className="all-day-ribbons"
          style={{
            gridTemplateColumns: `repeat(${days.length},minmax(0,1fr))`,
          }}
        >
          {weekSegments(
            events.filter((e) => e.allDay),
            days[0],
            days.length,
          ).map((segment) => (
            <button
              key={`${segment.event.calendarId}:${segment.event.id}`}
              className={`calendar-ribbon ${segment.continuesBefore ? "continues-before" : ""} ${segment.continuesAfter ? "continues-after" : ""}`}
              style={
                {
                  gridColumn: `${segment.start + 1}/${segment.end + 1}`,
                  gridRow: segment.lane + 1,
                  "--event-color": color(segment.event),
                } as React.CSSProperties
              }
              onClick={(ev) => onEvent(segment.event, ev.currentTarget)}
              onDoubleClick={(ev) => edit(segment.event, ev)}
            >
              {segment.event.title}
            </button>
          ))}
        </div>
      </div>
      <div className="time-scroll" ref={scroll}>
        <div className="time-body">
          <div className="hour-labels">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * 64 }}>
                {h ? `${String(h).padStart(2, "0")}:00` : ""}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const timed = events
              .filter((e) => !e.allDay && onDay(e, d))
              .map((e) => {
                const start = eventDate(e.start),
                  end = eventDate(e.end);
                return {
                  ...e,
                  startMinute: isSameDay(start, d)
                    ? start.getHours() * 60 + start.getMinutes()
                    : 0,
                  endMinute: isSameDay(end, d)
                    ? end.getHours() * 60 + end.getMinutes()
                    : 1440,
                };
              });
            const positioned = layoutEvents(timed);
            const now = new Date();
            return (
              <div
                key={d.toISOString()}
                className={`day-column ${isSameDay(d, now) ? "is-today" : ""}`}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    disabled={readOnly}
                    className="hour-slot"
                    tabIndex={h === 9 && isSameDay(d, date) ? 0 : -1}
                    data-day={format(d, "yyyy-MM-dd")}
                    data-hour={h}
                    onKeyDown={(ev) => {
                      if (
                        ![
                          "ArrowUp",
                          "ArrowDown",
                          "ArrowLeft",
                          "ArrowRight",
                          "Home",
                          "End",
                        ].includes(ev.key)
                      )
                        return;
                      ev.preventDefault();
                      ev.stopPropagation();
                      let day = new Date(d),
                        hour = h;
                      if (ev.key === "ArrowUp") hour = Math.max(0, h - 1);
                      if (ev.key === "ArrowDown") hour = Math.min(23, h + 1);
                      if (ev.key === "ArrowLeft") day = addDays(d, -1);
                      if (ev.key === "ArrowRight") day = addDays(d, 1);
                      if (ev.key === "Home") hour = 0;
                      if (ev.key === "End") hour = 23;
                      const target = ev.currentTarget
                        .closest(".time-body")
                        ?.querySelector<HTMLButtonElement>(
                          `[data-day="${format(day, "yyyy-MM-dd")}"][data-hour="${hour}"]`,
                        );
                      if (target) target.focus();
                    }}
                    style={{ top: h * 64 }}
                    aria-label={`Create event ${format(d, "EEEE MMMM d")} at ${h}:00`}
                    onClick={() => {
                      const n = new Date(d);
                      n.setHours(h, 0, 0, 0);
                      onCreate(n);
                    }}
                  />
                ))}
                {positioned.map((e) => (
                  <button
                    key={`${e.calendarId}:${e.id}`}
                    className="time-event"
                    style={
                      {
                        top: (e.top / 60) * 64,
                        height: Math.max(
                          25,
                          ((e.bottom - e.top) / 60) * 64 - 3,
                        ),
                        left: `calc(${(e.column / e.columns) * 100}% + 3px)`,
                        width: `calc(${100 / e.columns}% - 6px)`,
                        "--event-color": color(e),
                      } as React.CSSProperties
                    }
                    onClick={(ev) => onEvent(e, ev.currentTarget)}
                    onDoubleClick={(ev) => edit(e, ev)}
                  >
                    <strong>{e.title}</strong>
                    <span>
                      {format(eventDate(e.start), "HH:mm")} –{" "}
                      {format(eventDate(e.end), "HH:mm")}
                    </span>
                    {e.location && (
                      <span className="event-location">{e.location}</span>
                    )}
                  </button>
                ))}
                {isSameDay(d, now) && (
                  <div
                    className="now-line"
                    style={{
                      top: ((now.getHours() * 60 + now.getMinutes()) / 60) * 64,
                    }}
                  >
                    <i />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
