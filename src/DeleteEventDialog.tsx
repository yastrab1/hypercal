import { useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "./types";
import type { RecurrenceScope } from "./RecurrenceDialog";
export function DeleteEventDialog({
  event,
  onCancel,
  onDelete,
}: {
  event: CalendarEvent;
  onCancel: () => void;
  onDelete: (scope: RecurrenceScope) => Promise<void>;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<RecurrenceScope>("instance");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    cancel.current?.focus();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="delete-event-dialog"
      aria-labelledby="delete-heading"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <section>
        <h2 id="delete-heading">Delete event?</h2>
        <p>{event.title}</p>
        {event.recurring && (
          <fieldset disabled={busy}>
            <legend>Delete from this series</legend>
            {(
              [
                ["instance", "This event"],
                ["following", "This and following events"],
                ["all", "All events"],
              ] as const
            ).map(([v, label]) => (
              <label key={v}>
                <input
                  type="radio"
                  name="delete-scope"
                  checked={scope === v}
                  onChange={() => setScope(v)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <button
            ref={cancel}
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onDelete(scope);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete event"}
          </button>
        </footer>
      </section>
    </dialog>
  );
}
