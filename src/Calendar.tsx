import { monthRange } from "./period.mjs";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import {
  addDays,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  differenceInCalendarDays,
} from "date-fns";
import type { Calendar, CalendarEvent, Layout } from "./types";
import { weekSegments } from "./domain.mjs";
import {
  calendarDay,
  createCalendarIndex,
  dateForDay,
  type CalendarIndex,
  type CalendarDayBucket,
  type CalendarWeekBucket,
} from "./calendar-index.mjs";
export function eventDate(value: string) {
  return new Date(value.length === 10 ? value + "T00:00:00" : value);
}
export function onDay(e: CalendarEvent, date: Date) {
  const from = startOfDay(date);
  return eventDate(e.start) < addDays(from, 1) && eventDate(e.end) > from;
}
interface Props {
  onEdit?: (event: CalendarEvent) => void;
  monthWindow?: { start: Date; weeks: number };
  weekWindow?: { start: Date; days: number };
  readOnly?: boolean;
  layout: Layout;
  date: Date;
  events: CalendarEvent[];
  calendars: Calendar[];
  onEvent: (e: CalendarEvent, anchor: HTMLElement) => void;
  onCreate: (d: Date) => void;
  onDate: (d: Date, layout?: Layout) => void;
  onExpandDay: (date: Date, anchor: HTMLElement) => void;
}
type Actions = Pick<
  Props,
  "onEvent" | "onCreate" | "onDate" | "onExpandDay"
> & { edit: (event: CalendarEvent, ev: React.MouseEvent) => void };
type Color = (event: CalendarEvent) => string;
export function CalendarCanvas(props: Props) {
  const {
    layout,
    date,
    events,
    calendars,
    monthWindow,
    weekWindow,
    readOnly = false,
  } = props;
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const latest = useRef(props);
  latest.current = props;
  const actions = useMemo<Actions>(
    () => ({
      onEvent: (...args) => latest.current.onEvent(...args),
      onCreate: (...args) => latest.current.onCreate(...args),
      onDate: (...args) => latest.current.onDate(...args),
      onExpandDay: (...args) => latest.current.onExpandDay(...args),
      edit: (event, ev) => {
        ev.stopPropagation();
        if (!latest.current.readOnly && !event.readOnly)
          latest.current.onEdit?.(event);
      },
    }),
    [],
  );
  const previous = useRef<CalendarIndex | undefined>(undefined);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const index = useMemo(() => {
    const next = createCalendarIndex(events, previous.current, timeZone);
    previous.current = next;
    return next;
  }, [events, timeZone]);
  const palette = useMemo(
    () => new Map(calendars.map((c) => [c.id, c.color])),
    [calendars],
  );
  const color = useCallback<Color>(
    (e) => e.color || palette.get(e.calendarId) || "#039be5",
    [palette],
  );
  const scroll = useRef<HTMLDivElement>(null),
    monthRef = useRef<HTMLDivElement>(null);
  const [monthHeight, setMonthHeight] = useState(600);
  useEffect(() => {
    const el = monthRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setMonthHeight(entry.contentRect.height),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * 64;
  }, [layout]);
  const now = new Date(),
    today = calendarDay(now),
    selected = calendarDay(date);
  if (layout === "year")
    return (
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, month) => {
          const d = new Date(date.getFullYear(), month, 1),
            begin = startOfWeek(d, { weekStartsOn: 1 });
          const count =
            35 + (differenceInCalendarDays(endOfMonth(d), begin) > 34 ? 7 : 0);
          const buckets = Array.from({ length: count }, (_, i) =>
            index.day(calendarDay(begin) + i),
          );
          return (
            <YearMonth
              key={month}
              year={date.getFullYear()}
              month={month}
              buckets={buckets}
              today={today}
              color={color}
              actions={actions}
            />
          );
        })}
      </div>
    );
  if (layout === "month") {
    const range = monthWindow
      ? {
          from: monthWindow.start,
          to: addDays(monthWindow.start, monthWindow.weeks * 7),
        }
      : monthRange(date, mobile);
    const weeks = differenceInCalendarDays(range.to, range.from) / 7;
    const capacity = Math.max(
      1,
      Math.floor(
        ((monthHeight - 36) / weeks - (mobile ? 27 : 32) - 18) /
          (mobile ? 16 : 22),
      ),
    );
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
          style={{ gridTemplateRows: `repeat(${weeks},minmax(0,1fr))` }}
        >
          {Array.from({ length: weeks }, (_, i) => (
            <MonthWeek
              key={monthWindow ? calendarDay(range.from) + i * 7 : i}
              week={index.week(calendarDay(range.from) + i * 7)}
              month={date.getFullYear() * 12 + date.getMonth()}
              today={today}
              capacity={capacity}
              readOnly={readOnly}
              showMonth={!!monthWindow}
              color={color}
              actions={actions}
            />
          ))}
        </div>
      </div>
    );
  }
  const first =
    layout === "day"
      ? selected
      : calendarDay(
          weekWindow?.start || startOfWeek(date, { weekStartsOn: 1 }),
        );
  const days = Array.from(
    { length: layout === "day" ? 1 : weekWindow?.days || 7 },
    (_, i) => index.day(first + i),
  );
  const ribbons = weekSegments(
    index.allDay(first, days.length),
    dateForDay(first),
    days.length,
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
        {days.map((d, i) => (
          <DayHeading
            key={weekWindow ? d.number : i}
            day={d}
            today={today}
            actions={actions}
          />
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
          {ribbons.map((segment) => (
            <Ribbon
              key={`${segment.event.calendarId}:${segment.event.id}`}
              segment={segment}
              color={color}
              actions={actions}
            />
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
          {days.map((day, i) => (
            <TimeColumn
              key={weekWindow ? day.number : i}
              day={day}
              selected={selected === day.number}
              nowMinute={
                today === day.number
                  ? now.getHours() * 60 + now.getMinutes()
                  : null
              }
              readOnly={readOnly}
              color={color}
              actions={actions}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
const YearMonth = memo(
  function YearMonth({
    year,
    month,
    buckets,
    today,
    color,
    actions,
  }: {
    year: number;
    month: number;
    buckets: CalendarDayBucket[];
    today: number;
    color: Color;
    actions: Actions;
  }) {
    const date = new Date(year, month, 1);
    return (
      <section className="mini-month">
        <button
          className="month-title"
          onClick={() => actions.onDate(date, "month")}
        >
          {format(date, "MMMM")}
        </button>
        <div className="mini-grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={"h" + i} className="mini-weekday">
              {d}
            </span>
          ))}
          {buckets.map((d, i) => (
            <button
              key={i}
              disabled={d.date.getMonth() !== month}
              className={`${d.number === today ? "today " : ""}${d.all.length ? "has-events" : ""}`}
              onClick={() => actions.onDate(d.date, "day")}
              aria-label={`${format(d.date, "EEEE, MMMM d")}, ${d.all.length} events`}
            >
              {d.date.getDate()}
              {d.all.length > 0 && (
                <i style={{ background: color(d.all[0]) }} />
              )}
            </button>
          ))}
        </div>
      </section>
    );
  },
  (a, b) =>
    a.year === b.year &&
    a.month === b.month &&
    a.today === b.today &&
    a.color === b.color &&
    a.actions === b.actions &&
    a.buckets.length === b.buckets.length &&
    a.buckets.every((day, i) => day === b.buckets[i]),
);
const MonthWeek = memo(function MonthWeek({
  week,
  month,
  today,
  capacity,
  readOnly,
  showMonth,
  color,
  actions,
}: {
  week: CalendarWeekBucket;
  month: number;
  today: number;
  capacity: number;
  readOnly: boolean;
  showMonth: boolean;
  color: Color;
  actions: Actions;
}) {
  const lanes = week.ribbons.reduce((n, s) => Math.max(n, s.lane + 1), 0),
    visibleLanes = Math.min(lanes, capacity),
    remaining = Math.max(0, capacity - visibleLanes);
  return (
    <div
      className="month-week"
      style={{ "--ribbon-lanes": visibleLanes } as React.CSSProperties}
    >
      {week.days.map((day, i) => {
        const es = day.single;
        const hidden =
          week.ribbons.filter(
            (s) => s.lane >= visibleLanes && i >= s.start && i < s.end,
          ).length + Math.max(0, es.length - remaining);
        return (
          <div
            key={i}
            className={`month-cell ${day.date.getFullYear() * 12 + day.date.getMonth() !== month ? "outside" : ""}`}
            onClick={(ev) => {
              if (!(ev.target as HTMLElement).closest("button"))
                actions.onDate(day.date, "day");
            }}
          >
            <button
              className={`date-number ${day.number === today ? "today" : ""}`}
              onClick={(e) => actions.onExpandDay(day.date, e.currentTarget)}
              aria-label={`Events and countdown for ${format(day.date, "MMMM d")}`}
            >
              {showMonth && day.date.getDate() === 1
                ? format(day.date, "MMM d")
                : day.date.getDate()}
            </button>
            <button
              disabled={readOnly}
              className="cell-create"
              aria-label={`Create event on ${format(day.date, "MMMM d")}`}
              onClick={() => actions.onCreate(day.date)}
            >
              +
            </button>
            <div
              className="month-events"
              style={{
                paddingTop: `calc(${visibleLanes} * var(--ribbon-step))`,
              }}
            >
              {es.slice(0, remaining).map((e) => (
                <EventChip
                  key={`${e.calendarId}:${e.id}`}
                  event={e}
                  color={color}
                  actions={actions}
                />
              ))}
              {hidden > 0 && (
                <button
                  className="more-events"
                  aria-label={`Show all events on ${format(day.date, "MMMM d")}`}
                  onClick={(ev) =>
                    actions.onExpandDay(
                      day.date,
                      ev.currentTarget.closest(".month-cell") as HTMLElement,
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
        {week.ribbons
          .filter((s) => s.lane < visibleLanes)
          .map((s) => (
            <Ribbon
              key={`${s.event.calendarId}:${s.event.id}`}
              segment={s}
              color={color}
              actions={actions}
              month
            />
          ))}
      </div>
    </div>
  );
});
function EventChip({
  event: e,
  color,
  actions,
}: {
  event: CalendarEvent;
  color: Color;
  actions: Actions;
}) {
  return (
    <button
      className={`event-chip compact ${e.allDay ? "all-day" : ""}`}
      style={{ "--event-color": color(e) } as React.CSSProperties}
      onClick={(ev) => {
        ev.stopPropagation();
        actions.onEvent(e, ev.currentTarget);
      }}
      onDoubleClick={(ev) => actions.edit(e, ev)}
      title={`${e.title}${e.location ? " · " + e.location : ""}`}
    >
      <span className="event-dot" />
      {!e.allDay && <time>{format(eventDate(e.start), "HH:mm")}</time>}
      <span>{e.title}</span>
    </button>
  );
}
function Ribbon({
  segment: s,
  color,
  actions,
  month = false,
}: {
  segment: CalendarWeekBucket["ribbons"][number];
  color: Color;
  actions: Actions;
  month?: boolean;
}) {
  return (
    <button
      className={`calendar-ribbon ${s.continuesBefore ? "continues-before" : ""} ${s.continuesAfter ? "continues-after" : ""}`}
      style={
        {
          gridColumn: `${s.start + 1}/${s.end + 1}`,
          gridRow: s.lane + 1,
          "--event-color": color(s.event),
        } as React.CSSProperties
      }
      onClick={(ev) => actions.onEvent(s.event, ev.currentTarget)}
      onDoubleClick={(ev) => actions.edit(s.event, ev)}
      aria-label={
        month
          ? `${s.event.title}, ${format(eventDate(s.event.start), "MMM d")} to ${format(new Date(+eventDate(s.event.end) - 1), "MMM d")}`
          : undefined
      }
    >
      <span>
        {month && !s.event.allDay
          ? `${format(eventDate(s.event.start), "HH:mm")} `
          : ""}
        {s.event.title}
      </span>
    </button>
  );
}
const DayHeading = memo(function DayHeading({
  day,
  today,
  actions,
}: {
  day: CalendarDayBucket;
  today: number;
  actions: Actions;
}) {
  return (
    <button
      className={`day-label ${day.number === today ? "current" : ""}`}
      onClick={(e) => actions.onExpandDay(day.date, e.currentTarget)}
    >
      <span>{format(day.date, "EEE")}</span>
      <strong>{day.date.getDate()}</strong>
    </button>
  );
});
const TimeColumn = memo(function TimeColumn({
  day,
  selected,
  nowMinute,
  readOnly,
  color,
  actions,
}: {
  day: CalendarDayBucket;
  selected: boolean;
  nowMinute: number | null;
  readOnly: boolean;
  color: Color;
  actions: Actions;
}) {
  const dateKey = format(day.date, "yyyy-MM-dd"),
    dateLabel = format(day.date, "EEEE MMMM d");
  return (
    <div className={`day-column ${nowMinute !== null ? "is-today" : ""}`}>
      {Array.from({ length: 24 }, (_, h) => (
        <button
          key={h}
          disabled={readOnly}
          className="hour-slot"
          tabIndex={h === 9 && selected ? 0 : -1}
          data-day={dateKey}
          data-hour={h}
          style={{ top: h * 64 }}
          aria-label={`Create event ${dateLabel} at ${h}:00`}
          onClick={() => {
            const n = new Date(day.date);
            n.setHours(h, 0, 0, 0);
            actions.onCreate(n);
          }}
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
            let targetDay = day.date,
              hour = h;
            if (ev.key === "ArrowUp") hour = Math.max(0, h - 1);
            if (ev.key === "ArrowDown") hour = Math.min(23, h + 1);
            if (ev.key === "ArrowLeft") targetDay = addDays(day.date, -1);
            if (ev.key === "ArrowRight") targetDay = addDays(day.date, 1);
            if (ev.key === "Home") hour = 0;
            if (ev.key === "End") hour = 23;
            ev.currentTarget
              .closest(".time-body")
              ?.querySelector<HTMLButtonElement>(
                `[data-day="${format(targetDay, "yyyy-MM-dd")}"][data-hour="${hour}"]`,
              )
              ?.focus();
          }}
        />
      ))}
      {day.positioned.map((e) => (
        <button
          key={`${e.calendarId}:${e.id}`}
          className="time-event"
          style={
            {
              top: (e.top / 60) * 64,
              height: Math.max(25, ((e.bottom - e.top) / 60) * 64 - 3),
              left: `calc(${(e.column / e.columns) * 100}% + 3px)`,
              width: `calc(${100 / e.columns}% - 6px)`,
              "--event-color": color(e),
            } as React.CSSProperties
          }
          onClick={(ev) => actions.onEvent(e, ev.currentTarget)}
          onDoubleClick={(ev) => actions.edit(e, ev)}
        >
          <strong>{e.title}</strong>
          <span>
            {format(eventDate(e.start), "HH:mm")} –{" "}
            {format(eventDate(e.end), "HH:mm")}
          </span>
          {e.location && <span className="event-location">{e.location}</span>}
        </button>
      ))}
      {nowMinute !== null && (
        <div className="now-line" style={{ top: (nowMinute / 60) * 64 }}>
          <i />
        </div>
      )}
    </div>
  );
});
