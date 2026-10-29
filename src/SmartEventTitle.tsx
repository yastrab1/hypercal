import { useId, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { format } from "date-fns";
import {
  calendarMention,
  findCalendars,
  type QuickDate,
} from "./quick-entry.mjs";
import type { Calendar } from "./types";

export function SmartEventTitle({
  value,
  onChange,
  calendars,
  calendarId,
  onCalendar,
  date,
  onLiteralDate,
  smart,
  defaultDate,
  onDetails,
}: {
  defaultDate: string;
  onDetails: () => void;
  value: string;
  onChange: (value: string) => void;
  calendars: Calendar[];
  calendarId: string;
  onCalendar: (id: string) => void;
  date: QuickDate | null;
  onLiteralDate: () => void;
  smart: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(value.length);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const mention = smart ? calendarMention(value, caret) : null;
  const options = mention ? findCalendars(calendars, mention.query) : [];
  const open = focused && !dismissed && !!mention;
  const index = Math.min(selected, options.length - 1);
  const pick = (calendar: Calendar) => {
    if (!mention) return;
    const next = value.slice(0, mention.from) + value.slice(mention.to);
    onChange(next);
    onCalendar(calendar.id);
    setCaret(mention.from);
    setDismissed(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(mention.from, mention.from);
    });
  };
  const calendar = calendars.find((c) => c.id === calendarId);
  return (
    <div className="smart-title">
      <label className="field title-field">
        <span className="sr-only">Event title</span>
        <input
          ref={input}
          autoFocus
          name="title"
          placeholder={smart ? "Add title, date, @calendar" : "Add title"}
          required
          maxLength={1024}
          value={value}
          role={smart ? "combobox" : undefined}
          aria-autocomplete={smart ? "list" : undefined}
          aria-expanded={smart ? open : undefined}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && options[index] ? `${listId}-${index}` : undefined
          }
          aria-describedby={smart ? `${listId}-help` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart || 0)}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart || 0);
            setDismissed(false);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (!open || e.nativeEvent.isComposing) return;
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              setSelected(
                (n) =>
                  (n + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                  Math.max(options.length, 1),
              );
            } else if (
              (e.key === "Enter" || e.key === "Tab") &&
              options[index]
            ) {
              e.preventDefault();
              e.stopPropagation();
              pick(options[index]);
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                requestAnimationFrame(() =>
                  input.current?.form?.requestSubmit(),
                );
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDismissed(true);
            }
          }}
        />
      </label>
      {open && (
        <div
          className="calendar-autocomplete"
          role="listbox"
          id={listId}
          aria-label="Choose calendar"
        >
          {options.map((c, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              id={`${listId}-${i}`}
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
            >
              <i style={{ background: c.color }} />
              <span>{c.name}</span>
              {i === index && <kbd>↵</kbd>}
            </button>
          ))}
          {!options.length && (
            <p role="status">No writable calendars match “{mention?.query}”.</p>
          )}
        </div>
      )}
      {smart && (
        <>
          <div className="quick-entry-chips">
            {calendar && (
              <button
                type="button"
                className="quick-calendar-chip"
                aria-label="Choose calendar by typing"
                onClick={() => {
                  const next = value.trimEnd() + (value.trimEnd() ? " @" : "@");
                  onChange(next);
                  setCaret(next.length);
                  setDismissed(false);
                  input.current?.focus();
                }}
              >
                <i style={{ background: calendar.color }} />@{calendar.name}
              </button>
            )}
            {date && (
              <button
                type="button"
                className="quick-date-chip"
                onClick={onLiteralDate}
                aria-label={`Keep ${date.phrase} as title text`}
                title="Keep these words in the title instead"
              >
                <CalendarDays size={14} />
                {format(new Date(date.date + "T12:00:00"), "EEE, d MMM yyyy")}
                <X size={13} />
              </button>
            )}
            {!date && (
              <button
                type="button"
                className="quick-date-chip"
                onClick={onDetails}
              >
                <CalendarDays size={14} />
                {format(new Date(defaultDate + "T12:00:00"), "EEE, d MMM")}
              </button>
            )}
          </div>
          <p className="quick-entry-help" id={`${listId}-help`}>
            Try “tmrw”, “in 2 days”, “mon”, “11.2” or @calendar.{" "}
            <span className="quick-keyboard-hint">
              ↑ ↓ to choose, Enter to select.
            </span>
          </p>
        </>
      )}
    </div>
  );
}
