import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Choice = {
  value: string;
  label: string;
  color?: string;
  disabled?: boolean;
};
export function EditorPicker({
  label,
  options,
  value,
  onChange,
  searchable,
  multi,
  extra,
}: {
  label: string;
  options: Choice[];
  value: string | string[];
  onChange: (value: string) => void;
  searchable?: boolean;
  multi?: boolean;
  extra?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const bounds = root.current.closest("dialog")?.getBoundingClientRect();
    const anchor = root.current.getBoundingClientRect();
    const below = (bounds?.bottom ?? innerHeight) - anchor.bottom;
    setAbove(below < 250 && anchor.top - (bounds?.top ?? 0) > below);
  }, [open]);
  const [query, setQuery] = useState("");
  const selected = Array.isArray(value) ? value : [value];
  const current = options.filter((o) => selected.includes(o.value));
  const needle = query.trim().toLowerCase();
  const matches = options.filter((o) =>
    o.label
      .toLowerCase()
      .replaceAll("_", " ")
      .includes(needle.replaceAll("_", " ")),
  );
  const canCreate =
    multi && needle && !options.some((o) => o.label.toLowerCase() === needle);
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (next: string) => {
    onChange(next);
    setQuery("");
    if (multi) search.current?.focus();
    else {
      close();
      trigger.current?.focus();
    }
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className={"editor-picker" + (above ? " opens-above" : "")}
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
          trigger.current?.focus();
        }
        const buttons = Array.from(
          root.current!.querySelectorAll<HTMLButtonElement>(
            ".picker-options button:enabled",
          ),
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (buttons.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          buttons[
            (index +
              (e.key === "ArrowDown" ? 1 : index < 0 ? 0 : -1) +
              buttons.length) %
              buttons.length
          ].focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="picker-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="picker-values">
          {current.length
            ? current.map((o) => (
                <span
                  className={multi ? "picker-chip" : "picker-value"}
                  style={
                    multi && o.color
                      ? {
                          background: `color-mix(in srgb, ${o.color} 18%, var(--paper))`,
                        }
                      : undefined
                  }
                  key={o.value}
                >
                  {o.color && <i style={{ background: o.color }} />}
                  {o.label}
                </span>
              ))
            : multi
              ? "Add tags"
              : value || label}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div id={id} className="picker-panel">
          {searchable && (
            <input
              ref={search}
              className="picker-search"
              aria-label={"Search " + label.toLowerCase()}
              value={query}
              maxLength={multi ? 60 : 100}
              placeholder={multi ? "Find or create a tag…" : "Search…"}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const exact = matches.find(
                    (o) => o.label.toLowerCase() === needle,
                  );
                  if (canCreate) pick(query.trim());
                  else if (!(exact || matches[0])?.disabled && matches.length)
                    pick((exact || matches[0]).value);
                }
              }}
            />
          )}
          <div
            className="picker-options"
            role="group"
            aria-label={label + " options"}
          >
            {matches.map((o) => (
              <button
                type="button"
                key={o.value}
                disabled={o.disabled}
                aria-pressed={selected.includes(o.value)}
                onClick={() => pick(o.value)}
              >
                {o.color && <i style={{ background: o.color }} />}
                <span>{o.label}</span>
                {selected.includes(o.value) && <Check size={15} />}
              </button>
            ))}
            {canCreate && (
              <button type="button" onClick={() => pick(query.trim())}>
                Create “{query.trim()}”
              </button>
            )}
            {!matches.length && !canCreate && (
              <small>
                {multi ? "Type a tag name to create it." : "No matches"}
              </small>
            )}
          </div>
          {extra}
        </div>
      )}
    </div>
  );
}
