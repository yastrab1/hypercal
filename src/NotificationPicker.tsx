import { useEffect, useRef, useState } from "react";
import {
  notificationPresets,
  notificationParts,
  validNotification,
} from "./notifications.mjs";

export function NotificationPicker({
  value,
  onChange,
  label = "Notification",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const standard = ["calendar", "none", ...notificationPresets.map(String)];
  const [custom, setCustom] = useState(!standard.includes(value));
  const [amount, setAmount] = useState(String(notificationParts(value).amount));
  const [unit, setUnit] = useState(notificationParts(value).unit);
  const emitted = useRef(value);
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const p = notificationParts(value);
    setAmount(String(p.amount));
    setUnit(p.unit);
    setCustom(!standard.includes(value));
  }, [value]);
  const emit = (next: string) => {
    emitted.current = next;
    onChange(next);
  };
  const update = (n: string, u: number) => {
    setAmount(n);
    setUnit(u);
    if (n !== "" && validNotification(String(Number(n) * u)))
      emit(String(Number(n) * u));
  };
  return (
    <div className="notification-picker">
      <select
        aria-label={label}
        value={custom ? "custom" : value}
        onChange={(e) => {
          const next = e.target.value;
          setCustom(next === "custom");
          if (next === "custom") {
            const p = notificationParts(value);
            setAmount(String(p.amount));
            setUnit(p.unit);
            emit(String(p.amount * p.unit));
          } else emit(next);
        }}
      >
        <option value="calendar">Calendar default notification</option>
        <option value="none">No notification</option>
        {notificationPresets.map((n) => (
          <option key={n} value={String(n)}>
            {n === 0
              ? "At event time"
              : n === 1440
                ? "1 day before"
                : n === 60
                  ? "1 hour before"
                  : `${n} minutes before`}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {custom && (
        <div className="custom-notification">
          <input
            aria-label={`${label} amount`}
            required
            type="number"
            min={0}
            max={40320 / unit}
            step={1}
            value={amount}
            onChange={(e) => update(e.target.value, unit)}
          />
          <select
            aria-label={`${label} unit`}
            value={unit}
            onChange={(e) => update(amount, Number(e.target.value))}
          >
            <option value={1}>Minutes</option>
            <option value={60}>Hours</option>
            <option value={1440}>Days</option>
          </select>
          <span>before</span>
        </div>
      )}
    </div>
  );
}
export function NotificationDefaults({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (value: string) => Promise<void>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setDraft(value), [value]);
  return (
    <form
      className="notification-defaults"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSave(draft);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Default notification</h3>
      <p className="small muted">
        Applies to new events. Existing events keep their notifications. You can
        override this in each event.
      </p>
      <fieldset disabled={disabled || busy}>
        <NotificationPicker
          label="Default notification"
          value={draft}
          onChange={setDraft}
        />
        <button
          className="secondary-button"
          disabled={draft === value}
          type="submit"
        >
          {busy ? "Saving…" : "Save notification default"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
