import { NotificationPicker } from "./NotificationPicker";
import { notificationFields } from "./notifications.mjs";
import { defaultEventColors } from "./event-colors.mjs";
import { useEffect, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import {
  AlignLeft,
  Bell,
  Check,
  Clock,
  ExternalLink,
  Globe,
  LoaderCircle,
  MapPin,
  Palette,
  Repeat2,
  Trash2,
  X,
} from "lucide-react";
import type { Calendar, CalendarEvent } from "./types";
import { eventDate } from "./Calendar";
export function EventEditor({
  event,
  date,
  calendars,
  live,
  offline,
  email,
  notificationDefault,
  onSave,
  onDelete,
  onClose,
}: {
  event: CalendarEvent | null;
  date: Date;
  calendars: Calendar[];
  live: boolean;
  offline: boolean;
  email?: string;
  notificationDefault: string;
  onSave: (e: CalendarEvent, recurrence: string) => Promise<void>;
  onDelete: (e: CalendarEvent) => Promise<void>;
  onClose: () => void;
}) {
  const [color, setColor] = useState(event?.color || "");
  const [allDay, setAllDay] = useState(event?.allDay || false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const [calendarId, setCalendarId] = useState(
    event?.calendarId ||
      calendars.find((c) => c.primary && !c.readOnly)?.id ||
      calendars.find((c) => !c.readOnly)?.id ||
      "",
  );
  const initialReminder = !event
    ? notificationDefault
    : event.reminderMinutes === null
      ? "none"
      : event.reminderMinutes === undefined
        ? "calendar"
        : String(event.reminderMinutes);
  const [reminder, setReminder] = useState(initialReminder),
    [reminderChanged, setReminderChanged] = useState(!event);
  const form = useRef<HTMLFormElement>(null);
  const readOnly = !!event?.readOnly;
  const disabled = readOnly || offline || busy;
  const start = event ? eventDate(event.start) : date,
    end = event ? eventDate(event.end) : new Date(+date + 3600000);
  const [startInput, setStartInput] = useState(format(start, "yyyy-MM-dd")),
    [endInput, setEndInput] = useState(
      format(event?.allDay ? addDays(end, -1) : end, "yyyy-MM-dd"),
    );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const calendar = calendars.find((c) => c.id === calendarId);
  const writable = calendars.filter((c) => !c.readOnly);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!disabled) form.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disabled]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    setError("");
    const f = new FormData(e.currentTarget);
    const s = allDay
      ? startInput
      : new Date(`${startInput}T${f.get("startTime")}`).toISOString();
    const t = allDay
      ? format(addDays(new Date(endInput + "T12:00:00"), 1), "yyyy-MM-dd")
      : new Date(`${endInput}T${f.get("endTime")}`).toISOString();
    if (new Date(t) <= new Date(s)) {
      setError("End must be after start.");
      return;
    }
    setBusy(true);
    try {
      await onSave(
        {
          id: event?.id || "",
          calendarId,
          title: String(f.get("title")).trim(),
          description: String(f.get("description")),
          location: String(f.get("location")),
          start: s,
          end: t,
          allDay,
          color: color || null,
          readOnly: false,
          source: live ? "google" : "demo",
          etag: event?.etag,
          timeZone: timezone,
          ...(reminderChanged ? notificationFields(reminder) : {}),
        },
        String(f.get("recurrence") || "none"),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      id="event-editor-form"
      ref={form}
      onSubmit={submit}
      className="editor-form event-editor"
    >
      <div className="event-editor-topbar">
        <button
          type="button"
          className="icon-button"
          aria-label="Close event editor"
          onClick={onClose}
        >
          <X size={24} />
        </button>
        {!readOnly && (
          <button
            type="submit"
            className="primary-button"
            disabled={disabled || !writable.length}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {!live && (
        <div className="inline-note event-status">
          Demo event · saved only on this device
        </div>
      )}
      {offline && (
        <div className="inline-note event-status">
          Saved event. Connect and sync before editing.
        </div>
      )}
      {readOnly && (
        <div className="inline-note event-status">
          Read-only calendar. Edit this event with its provider.
        </div>
      )}
      {event?.recurring && (
        <div className="inline-note event-status">
          Changes apply to this occurrence only.
        </div>
      )}
      <fieldset disabled={disabled}>
        <label className="field title-field">
          <span className="sr-only">Event title</span>
          <input
            autoFocus
            name="title"
            placeholder="Add title"
            required
            maxLength={1024}
            defaultValue={event?.title}
          />
        </label>
        <div className="event-kind">Event</div>
        <div className="event-editor-section event-calendar-row">
          <span
            className="calendar-color-marker"
            style={{ background: calendar?.color }}
          />
          <label className="field">
            <span className="sr-only">Calendar</span>
            <select
              aria-label="Calendar"
              value={calendarId}
              disabled={!!event}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              {(event
                ? calendars.filter((c) => c.id === event.calendarId)
                : writable
              ).map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <small>{live ? email : "Demo calendar"}</small>
          </label>
        </div>
        <div className="event-editor-section">
          <label className="event-all-day">
            <Clock size={20} />
            <span>All-day</span>
            <input
              type="checkbox"
              role="switch"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
          </label>
          <div className="event-datetime-row">
            <label className="field">
              <span className="sr-only">Start date</span>
              <input
                aria-label="Start date"
                required
                type="date"
                value={startInput}
                onChange={(e) => {
                  setStartInput(e.target.value);
                  if (e.target.value > endInput) setEndInput(e.target.value);
                }}
              />
            </label>
            {!allDay && (
              <label className="field">
                <span className="sr-only">Start time</span>
                <input
                  aria-label="Start time"
                  required
                  name="startTime"
                  type="time"
                  defaultValue={format(start, "HH:mm")}
                />
              </label>
            )}
          </div>
          <div className="event-datetime-row">
            <label className="field">
              <span className="sr-only">
                {allDay ? "Last day" : "End date"}
              </span>
              <input
                aria-label={allDay ? "Last day" : "End date"}
                required
                type="date"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
              />
            </label>
            {!allDay && (
              <label className="field">
                <span className="sr-only">End time</span>
                <input
                  aria-label="End time"
                  required
                  name="endTime"
                  type="time"
                  defaultValue={format(end, "HH:mm")}
                />
              </label>
            )}
          </div>
          <div className="event-detail-row">
            <Globe size={20} />
            <span>{timezone}</span>
          </div>
          {!event && (
            <label className="event-detail-row">
              <Repeat2 size={20} />
              <span className="sr-only">Repeats</span>
              <select name="recurrence" aria-label="Repeats">
                <option value="none">Does not repeat</option>
                <option value="daily" disabled={!live}>
                  Every day
                </option>
                <option value="weekly" disabled={!live}>
                  Every week
                </option>
                <option value="monthly" disabled={!live}>
                  Every month
                </option>
              </select>
            </label>
          )}
        </div>
        <div className="event-editor-section">
          <label className="event-detail-row">
            <MapPin size={20} />
            <span className="sr-only">Location</span>
            <input
              name="location"
              aria-label="Location"
              placeholder="Add location or meeting link"
              defaultValue={event?.location}
              maxLength={1024}
            />
          </label>
        </div>
        <div className="event-editor-section event-color-section">
          <div className="event-detail-row">
            <Palette size={20} />
            <span>Event color</span>
          </div>
          <div
            className="event-color-options"
            role="group"
            aria-label="Event color"
          >
            <button
              type="button"
              className="color-default"
              aria-pressed={!color}
              onClick={() => setColor("")}
            >
              Calendar default
            </button>
            {defaultEventColors.map((c) => (
              <button
                key={c.hex}
                type="button"
                className="color-swatch"
                style={{ background: c.hex }}
                aria-label={c.name}
                title={c.name}
                aria-pressed={color.toLowerCase() === c.hex}
                onClick={() => setColor(c.hex)}
              >
                {color.toLowerCase() === c.hex && <Check size={17} />}
              </button>
            ))}
          </div>
          <label className="custom-event-color">
            Custom color
            <input
              type="color"
              aria-label="Custom event color"
              value={
                /^#[\da-f]{6}$/i.test(color)
                  ? color
                  : calendar?.color || "#039be5"
              }
              onChange={(e) => setColor(e.target.value)}
              onInput={(e) => setColor(e.currentTarget.value)}
            />
            <input
              className="color-hex"
              type="text"
              aria-label="Custom color hex"
              pattern="#[0-9a-fA-F]{6}"
              placeholder="#039be5"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              maxLength={7}
            />
          </label>
        </div>
        <div className="event-editor-section">
          <label className="event-detail-row">
            <Bell size={20} />
            <span className="sr-only">Notification</span>
            <NotificationPicker
              value={reminder}
              onChange={(value) => {
                setReminder(value);
                setReminderChanged(true);
              }}
            />
          </label>
        </div>
        <div className="event-editor-section">
          <label className="event-detail-row notes-row">
            <AlignLeft size={20} />
            <span className="sr-only">Notes</span>
            <textarea
              name="description"
              aria-label="Notes"
              rows={3}
              placeholder="Add description"
              defaultValue={event?.description}
              maxLength={8000}
            />
          </label>
        </div>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!readOnly && (
        <div className="form-actions">
          <button
            className="primary-button desktop-save"
            disabled={disabled || !writable.length}
            type="submit"
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            {busy ? "Saving…" : "Save event"}
            <kbd>Ctrl ↵</kbd>
          </button>
          {event && (
            <button
              type="button"
              className="danger-button"
              disabled={disabled}
              onClick={async () => {
                if (!deleting) {
                  setDeleting(true);
                  return;
                }
                setBusy(true);
                try {
                  await onDelete(event);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 size={16} />
              {deleting ? "Confirm delete" : "Delete event"}
            </button>
          )}
        </div>
      )}
      {event?.htmlLink && (
        <a
          className="subtle-link external-event"
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
        >
          Open in Google Calendar <ExternalLink size={14} />
        </a>
      )}
    </form>
  );
}
