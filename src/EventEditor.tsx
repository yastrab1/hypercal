import { EditorPicker } from "./EditorPicker";
import { eventInstant, zonedInput } from "./editor-time.mjs";
import { SmartEventTitle } from "./SmartEventTitle";
import { parseQuickDate, withoutDatePhrase } from "./quick-entry.mjs";
import { cleanTags } from "./tags.mjs";
import { NotificationPicker } from "./NotificationPicker";
import { notificationFields } from "./notifications.mjs";
import { defaultEventColors } from "./event-colors.mjs";
import { useEffect, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import {
  AlignLeft,
  Tags,
  CalendarDays,
  Bell,
  Check,
  Clock,
  ExternalLink,
  Globe,
  LoaderCircle,
  MapPin,
  Palette,
  Plus,
  Repeat2,
  Trash2,
  X,
} from "lucide-react";
import type { Calendar, CalendarEvent, Tag } from "./types";
import { eventDate } from "./Calendar";
export function EventEditor({
  event,
  tags,
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
  tags: Tag[];
  event: CalendarEvent | null;
  date: Date;
  calendars: Calendar[];
  live: boolean;
  offline: boolean;
  email?: string;
  notificationDefault: string;
  onSave: (
    e: CalendarEvent,
    recurrence: string,
    interval?: { every: number; unit: "day" | "month" | "year" },
  ) => Promise<void>;
  onDelete: (e: CalendarEvent) => Promise<void>;
  onClose: () => void;
}) {
  const [details, setDetails] = useState(!!event);
  const [title, setTitle] = useState(event?.title || "");
  const [literalDate, setLiteralDate] = useState(false);
  const [today] = useState(() => new Date());
  const quickDate =
    !event && !literalDate ? parseQuickDate(title, today) : null;
  const [eventTags, setEventTags] = useState<string[]>(event?.tags || []);

  const [color, setColor] = useState(event?.color || "");
  const [allDay, setAllDay] = useState(event?.allDay || false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const defaultCalendarId = () =>
    calendars.find((c) => c.primary && !c.readOnly)?.id ||
    calendars.find((c) => !c.readOnly)?.id ||
    "";
  const [calendarId, setCalendarId] = useState(
    event?.calendarId || defaultCalendarId(),
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
  const [repeat, setRepeat] = useState("none"),
    [every, setEvery] = useState("2"),
    [unit, setUnit] = useState<"day" | "month" | "year">("day");
  const form = useRef<HTMLFormElement>(null);
  const readOnly = !!event?.readOnly;
  const disabled = readOnly || offline || busy;
  const start = event ? eventDate(event.start) : date,
    end = event ? eventDate(event.end) : new Date(+date + 3600000);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timezone, setTimezone] = useState(event?.timeZone || localZone);
  const startWall = zonedInput(start, timezone);
  const endWall = zonedInput(end, timezone);
  const [startTime, setStartTime] = useState(startWall.slice(11));
  const [endTime, setEndTime] = useState(endWall.slice(11));
  const [startInput, setStartInput] = useState(
      event?.allDay ? event.start : startWall.slice(0, 10),
    ),
    [endInput, setEndInput] = useState(
      event?.allDay
        ? format(addDays(end, -1), "yyyy-MM-dd")
        : endWall.slice(0, 10),
    );
  const effectiveStart = quickDate?.date || startInput;
  const effectiveEnd = quickDate
    ? format(
        addDays(
          new Date(quickDate.date + "T12:00:00"),
          Math.max(
            0,
            differenceInCalendarDays(
              new Date(endInput + "T12:00:00"),
              new Date(startInput + "T12:00:00"),
            ),
          ),
        ),
        "yyyy-MM-dd",
      )
    : endInput;
  const commitQuickDate = () => {
    if (!quickDate) return;
    setTitle(withoutDatePhrase(title, quickDate));
    setStartInput(effectiveStart);
    setEndInput(effectiveEnd);
  };
  const calendar = calendars.find((c) => c.id === calendarId);
  const writable = calendars.filter((c) => !c.readOnly);
  // Calendars can finish loading (or permissions change) after the editor
  // opens; never keep a missing/read-only selection for a new event.
  useEffect(() => {
    if (event || writable.some((c) => c.id === calendarId)) return;
    setCalendarId(defaultCalendarId());
  });
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
    const cleanTitle = event
      ? title.trim()
      : withoutDatePhrase(title, quickDate);
    if (!cleanTitle) {
      setError("Add an event title as well as a date.");
      return;
    }
    if (!writable.some((c) => c.id === calendarId) && !event) {
      setError("Choose a calendar you can write to.");
      return;
    }
    if (color && !/^#[a-f0-9]{6}$/i.test(color)) {
      setDetails(true);
      setError("Enter a six-digit hex color.");
      return;
    }
    const everyNumber = Number(every);
    if (
      repeat === "custom" &&
      !(/^\d+$/.test(every.trim()) && everyNumber >= 1 && everyNumber <= 999)
    ) {
      setError("Repeat interval must be a whole number from 1 to 999.");
      return;
    }
    const f = new FormData(e.currentTarget);
    try {
      const s = allDay
        ? effectiveStart
        : eventInstant(
            effectiveStart,
            startTime,
            timezone,
            event?.allDay ? undefined : event?.start,
          );
      const t = allDay
        ? format(addDays(new Date(effectiveEnd + "T12:00:00"), 1), "yyyy-MM-dd")
        : eventInstant(
            effectiveEnd,
            endTime,
            timezone,
            event?.allDay ? undefined : event?.end,
          );
      if (new Date(t) <= new Date(s)) {
        setError("End must be after start.");
        return;
      }
      setBusy(true);
      await onSave(
        {
          id: event?.id || "",
          calendarId,
          title: cleanTitle,
          tags: cleanTags(eventTags),
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
        repeat,
        repeat === "custom" ? { every: everyNumber, unit } : undefined,
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
          Choose which occurrences to update when you save.
        </div>
      )}
      <fieldset disabled={disabled}>
        <SmartEventTitle
          value={title}
          onChange={(value) => {
            setTitle(value);
            if (
              parseQuickDate(value, today)?.phrase !==
              parseQuickDate(title, today)?.phrase
            )
              setLiteralDate(false);
          }}
          calendars={calendars}
          calendarId={calendarId}
          onCalendar={setCalendarId}
          date={quickDate}
          onLiteralDate={() => setLiteralDate(true)}
          smart={!event}
          defaultDate={effectiveStart}
          onDetails={() => setDetails(true)}
        />
        <div className="quick-event-details" hidden={!details}>
          {event && (
            <div className="event-editor-section editor-calendar-info">
              <CalendarDays size={17} />
              <span className="property-label">Calendar</span>
              {readOnly || event.recurring ? (
                <span>{calendar?.name || calendarId}</span>
              ) : (
                <EditorPicker
                  label="Change calendar"
                  value={calendarId}
                  onChange={setCalendarId}
                  options={writable.map((c) => ({
                    value: c.id,
                    label: c.name,
                    color: c.color,
                  }))}
                />
              )}
              {live && email && <small title={email}>{email}</small>}
            </div>
          )}
          <div className="event-editor-section editor-schedule">
            <div className="schedule-heading">
              <h3>
                <Clock size={16} />
                Schedule
              </h3>
              <label className="event-all-day">
                <span>All-day</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                />
              </label>
            </div>
            <div className="event-datetime-row">
              <label className="field">
                <span className="editor-date-label">Starts</span>
                <input
                  aria-label="Start date"
                  required
                  type="date"
                  value={effectiveStart}
                  onChange={(e) => {
                    commitQuickDate();
                    setStartInput(e.target.value);
                    if (e.target.value > effectiveEnd)
                      setEndInput(e.target.value);
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
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="event-datetime-row">
              <label className="field">
                <span className="editor-date-label">
                  {allDay ? "Last day" : "Ends"}
                </span>
                <input
                  aria-label={allDay ? "Last day" : "End date"}
                  required
                  type="date"
                  value={effectiveEnd}
                  onChange={(e) => {
                    commitQuickDate();
                    setEndInput(e.target.value);
                  }}
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
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </label>
              )}
            </div>
            {!allDay && (
              <div className="event-detail-row">
                <Globe size={16} />
                <span className="property-label">Time zone</span>
                <EditorPicker
                  label="Time zone"
                  value={timezone}
                  onChange={setTimezone}
                  searchable
                  options={Array.from(
                    new Set([
                      timezone,
                      localZone,
                      "UTC",
                      ...Intl.supportedValuesOf("timeZone"),
                    ]),
                  ).map((zone) => ({
                    value: zone,
                    label: zone.replaceAll("_", " "),
                  }))}
                />
              </div>
            )}
            {!event && (
              <div className="event-detail-row event-repeat-row">
                <Repeat2 size={20} />
                <span className="property-label">Repeat</span>
                <EditorPicker
                  label="Repeats"
                  value={repeat}
                  onChange={setRepeat}
                  options={[
                    ["none", "Does not repeat"],
                    ["daily", "Every day"],
                    ["weekly", "Every week"],
                    ["monthly", "Every month"],
                    ["yearly", "Every year"],
                    ["custom", "Custom…"],
                  ].map(([value, label]) => ({
                    value,
                    label,
                    disabled: value !== "none" && !live,
                  }))}
                />

                {repeat === "custom" && (
                  <span className="event-repeat-custom">
                    Every
                    <input
                      aria-label="Repeat every"
                      type="number"
                      min={1}
                      max={999}
                      step={1}
                      inputMode="numeric"
                      required
                      value={every}
                      onChange={(e) => setEvery(e.target.value)}
                    />
                    <EditorPicker
                      label="Repeat unit"
                      value={unit}
                      onChange={(value) => setUnit(value as typeof unit)}
                      options={["day", "month", "year"].map((value) => ({
                        value,
                        label: every.trim() === "1" ? value : value + "s",
                      }))}
                    />
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="event-editor-section">
            <label className="event-detail-row">
              <MapPin size={20} />
              <span className="property-label">Location</span>
              <input
                name="location"
                aria-label="Location"
                placeholder="Place or meeting link"
                defaultValue={event?.location}
                maxLength={1024}
              />
            </label>
          </div>
          <div className="event-editor-section event-tag-section">
            <Tags size={17} />
            <span className="property-label">Tags</span>
            <EditorPicker
              label="Tags"
              value={eventTags}
              searchable
              multi
              options={[
                ...tags,
                ...eventTags
                  .filter((name) => !tags.some((t) => t.name === name))
                  .map((name) => ({ name, color: "#4b99d2" })),
              ].map((t) => ({
                value: t.name,
                label: t.name,
                color: t.color,
                disabled: tags.some(
                  (tag) =>
                    tag.name === t.name && tag.rule?.mode === "automatic",
                ),
              }))}
              onChange={(name) => {
                if (!eventTags.includes(name) && eventTags.length >= 12) {
                  setError("Choose up to 12 tags.");
                  return;
                }
                setEventTags(
                  eventTags.includes(name)
                    ? eventTags.filter((t) => t !== name)
                    : [...eventTags, name],
                );
              }}
            />
          </div>
          <div className="event-editor-section event-detail-row">
            <Palette size={17} />
            <span className="property-label">Color</span>
            <EditorPicker
              label="Event color"
              value={color}
              onChange={setColor}
              options={[
                { value: "", label: "Calendar color", color: calendar?.color },
                ...defaultEventColors.map((c) => ({
                  value: c.hex,
                  label: c.name,
                  color: c.hex,
                })),
                ...(color && !defaultEventColors.some((c) => c.hex === color)
                  ? [{ value: color, label: color, color }]
                  : []),
              ]}
              extra={
                <label className="custom-event-color">
                  Custom color
                  <input
                    type="color"
                    aria-label="Custom event color"
                    value={color || calendar?.color || "#039be5"}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <input
                    type="text"
                    className="color-hex"
                    aria-label="Custom color hex"
                    placeholder="#039be5"
                    value={color}
                    maxLength={7}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </label>
              }
            />
          </div>
          <div className="event-editor-section">
            <div className="event-detail-row">
              <Bell size={20} />
              <span className="property-label">Reminder</span>
              <NotificationPicker
                value={reminder}
                onChange={(value) => {
                  setReminder(value);
                  setReminderChanged(true);
                }}
              />
            </div>
          </div>
          <div className="event-editor-section">
            <label className="event-detail-row notes-row">
              <AlignLeft size={20} />
              <span className="property-label">Notes</span>
              <textarea
                name="description"
                aria-label="Notes"
                rows={2}
                placeholder="Add description"
                defaultValue={event?.description}
                maxLength={8000}
              />
            </label>
          </div>
        </div>
      </fieldset>
      {!event && (
        <button
          type="button"
          className="quick-more-details"
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          <Plus size={17} />
          {details ? "Fewer details" : "More details"}
        </button>
      )}
      {!live && (
        <small className="editor-storage-note">
          Demo · Saved on this device
        </small>
      )}
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
