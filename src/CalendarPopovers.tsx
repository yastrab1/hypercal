import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { addDays, format } from "date-fns";
import {
  AlignLeft,
  CalendarDays,
  Clock,
  ExternalLink,
  MapPin,
  Pencil,
  Repeat2,
  X,
} from "lucide-react";
import type { Calendar, CalendarEvent } from "./types";
import { eventDate } from "./Calendar";
function FloatingCard({
  anchor,
  width,
  label,
  onClose,
  children,
  className = "",
}: {
  anchor: HTMLElement;
  width: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 80 });
  useLayoutEffect(() => {
    const update = () => {
      const box = anchor.getBoundingClientRect(),
        card = ref.current?.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 24),
        h = card?.height || 240;
      let left = box.right + 12;
      if (left + w > window.innerWidth - 12) left = box.left - w - 12;
      if (left < 12)
        left = Math.max(12, Math.min(box.left, window.innerWidth - w - 12));
      setPosition({
        left,
        top: Math.max(12, Math.min(box.top - 12, window.innerHeight - h - 12)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, width]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button,a[href]")?.focus();
    const outside = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      if (
        className === "day-overflow" &&
        target.closest("[data-calendar-popover]")
      )
        return;
      onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, onClose, className]);
  return createPortal(
    <section
      ref={ref}
      role="dialog"
      aria-label={label}
      data-calendar-popover
      className={`calendar-popover ${className}`}
      style={{ ...position, width: Math.min(width, window.innerWidth - 24) }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </section>,
    document.body,
  );
}
function PlainNotes({ text }: { text: string }) {
  const readable = text.includes("<")
    ? new DOMParser().parseFromString(text, "text/html").body.textContent || ""
    : text;
  return (
    <div className="preview-notes">
      {readable.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </div>
  );
}
export function EventPopover({
  event,
  anchor,
  calendar,
  onClose,
  onEdit,
}: {
  event: CalendarEvent;
  anchor: HTMLElement;
  calendar?: Calendar;
  onClose: () => void;
  onEdit: () => void;
}) {
  const start = eventDate(event.start),
    end = eventDate(event.end);
  const last = event.allDay ? addDays(end, -1) : end;
  return (
    <FloatingCard
      anchor={anchor}
      width={405}
      label={`Event details: ${event.title}`}
      onClose={onClose}
      className="event-preview"
    >
      <div className="popover-actions">
        {!event.readOnly && (
          <button
            className="icon-button"
            aria-label="Edit event"
            title="Edit event"
            onClick={onEdit}
          >
            <Pencil size={19} />
          </button>
        )}
        {event.htmlLink && (
          <a
            className="icon-button"
            aria-label="Open in Google Calendar"
            href={event.htmlLink}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={18} />
          </a>
        )}
        <button
          className="icon-button"
          aria-label="Close event details"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="preview-heading">
        <i style={{ background: calendar?.color }} />
        <div>
          <h2>{event.title}</h2>
          <p>
            {format(start, "EEEE, MMMM d")}
            {format(start, "yyyy-MM-dd") !== format(last, "yyyy-MM-dd") &&
              ` – ${format(last, "EEEE, MMMM d")}`}
            {!event.allDay && (
              <>
                <br />
                {format(start, "HH:mm")} – {format(end, "HH:mm")}
              </>
            )}
            {event.allDay && <span className="preview-all-day">All day</span>}
          </p>
        </div>
      </div>
      {event.location && (
        <div className="preview-row">
          <MapPin size={18} />
          <span>{event.location}</span>
        </div>
      )}
      {event.description && (
        <div className="preview-row">
          <AlignLeft size={18} />
          <PlainNotes text={event.description} />
        </div>
      )}
      <div className="preview-row">
        <CalendarDays size={18} />
        <span>
          {calendar?.name || "Calendar"}
          {event.readOnly && <small>Read-only</small>}
        </span>
      </div>
      {event.recurring && (
        <div className="preview-row">
          <Repeat2 size={18} />
          <span>Repeating event</span>
        </div>
      )}
      <div className="preview-row preview-timezone">
        <Clock size={16} />
        <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
      </div>
    </FloatingCard>
  );
}
export function DayOverflowPopover({
  date,
  events,
  calendars,
  anchor,
  onClose,
  onEvent,
  onOpenDay,
}: {
  date: Date;
  events: CalendarEvent[];
  calendars: Calendar[];
  anchor: HTMLElement;
  onClose: () => void;
  onEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
  onOpenDay: () => void;
}) {
  const sorted = [...events].sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
  );
  return (
    <FloatingCard
      anchor={anchor}
      width={265}
      label={`Events on ${format(date, "MMMM d")}`}
      onClose={onClose}
      className="day-overflow"
    >
      <header>
        <button
          className="expanded-date"
          aria-label="Open default day view"
          onClick={onOpenDay}
        >
          <span>{format(date, "EEE")}</span>
          <strong>{format(date, "d")}</strong>
        </button>
        <button
          className="icon-button"
          aria-label="Close day events"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      <div className="expanded-events">
        {sorted.map((event) => (
          <button
            key={`${event.calendarId}:${event.id}`}
            className={`expanded-event ${event.allDay ? "expanded-all-day" : ""}`}
            style={
              {
                "--event-color":
                  calendars.find((c) => c.id === event.calendarId)?.color ||
                  "#039be5",
              } as React.CSSProperties
            }
            onClick={(e) => onEvent(event, e.currentTarget)}
          >
            <i />
            <span>
              {!event.allDay && (
                <time>{format(eventDate(event.start), "HH:mm")} </time>
              )}
              {event.title}
            </span>
          </button>
        ))}
      </div>
      <button className="open-day-link" onClick={onOpenDay}>
        Open day view
      </button>
    </FloatingCard>
  );
}
