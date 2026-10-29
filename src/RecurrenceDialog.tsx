import { useEffect, useRef, useState } from "react";
export type RecurrenceScope = "instance" | "all" | "following";
export function RecurrenceDialog({
  action,
  onChoose,
}: {
  action: "edit" | "delete";
  onChoose: (scope: RecurrenceScope | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<RecurrenceScope>("instance");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="recurrence-dialog"
      aria-labelledby="recurrence-title"
      onCancel={(e) => {
        e.preventDefault();
        onChoose(null);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onChoose(scope);
        }}
      >
        <h2 id="recurrence-title">
          {action === "delete"
            ? "Delete recurring event"
            : "Edit recurring event"}
        </h2>
        <p>Apply {action === "delete" ? "deletion" : "changes"} to:</p>
        {(
          [
            ["instance", "This event"],
            ["all", "All events"],
            ["following", "This and following events"],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="recurrence-scope"
              value={value}
              checked={scope === value}
              onChange={() => setScope(value)}
              autoFocus={value === "instance"}
            />
            {label}
          </label>
        ))}
        {scope === "following" && action === "edit" && (
          <p className="recurrence-note">
            This splits the series. Existing exceptions after this event reset
            to the updated schedule.
          </p>
        )}
        <div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChoose(null)}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={action === "delete" ? "danger-button" : "primary-button"}
          >
            Apply
          </button>
        </div>
      </form>
    </dialog>
  );
}
