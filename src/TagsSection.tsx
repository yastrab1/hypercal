import { useEffect, useState, useRef } from "react";
import { Plus, Check, ChevronDown, Eye, Pencil, Trash2, X } from "lucide-react";
import { countdown, pillInk, highlightColor } from "./tags.mjs";
import type { Tag, CalendarEvent } from "./types";
import { api } from "./api";
export function TagsSection({
  tags,
  live,
  canWrite,
  onChange,
  trackedTag,
  onTrack,
  onEdit,
  onDelete,
}: {
  tags: Tag[];
  live: boolean;
  canWrite: boolean;
  onChange: (tags: Tag[]) => Promise<void>;
  trackedTag: string | null;
  onTrack: (name: string | null) => Promise<void>;
  onEdit: (oldName: string, tag: Tag) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("hypercal.tagsCollapsed") || "true") ===
        true
      );
    } catch {
      return true;
    }
  });
  const [syncNote, setSyncNote] = useState("");
  useEffect(() => {
    if (!live) {
      setSyncNote("");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () =>
      api<{ pending: number; error: string | null }>("/tag-sync")
        .then((result) => {
          if (cancelled) return;
          setSyncNote(
            result.error ||
              (result.pending ? "Tag changes are syncing with Google…" : ""),
          );
          if (result.pending) timer = setTimeout(check, 4000);
        })
        .catch(() => {
          if (!cancelled)
            setSyncNote(
              "Tag sync status is unavailable. Saved changes will retry.",
            );
        });
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [live, JSON.stringify(tags)]);
  const [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    section.current
      ?.querySelector(".tag-edit-form,.tag-delete-confirm")
      ?.scrollIntoView({ block: "nearest" });
  }, [editing, deleting]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setEditing(null);
      setDeleting(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(values: Tag[]) {
    setBusy(true);
    setError("");
    try {
      await onChange(values);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section ref={section} className="tags-section" aria-label="Tags">
      <div className="section-label">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={!collapsed}
          aria-controls="sidebar-tags"
          onClick={() => {
            setCollapsed(!collapsed);
            localStorage.setItem(
              "hypercal.tagsCollapsed",
              JSON.stringify(!collapsed),
            );
          }}
        >
          Tags{" "}
          <ChevronDown
            size={15}
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
          />
        </button>
        <button
          className="icon-button"
          aria-label="Create tag"
          disabled={busy || (live && !canWrite)}
          onClick={() => {
            setCollapsed(false);
            localStorage.setItem("hypercal.tagsCollapsed", "false");
            setAdding(!adding);
          }}
        >
          <Plus size={16} />
        </button>
      </div>
      <div id="sidebar-tags" hidden={collapsed}>
        {!tags.length && !adding && (
          <p className="sidebar-hint">Tag events, then track the next one.</p>
        )}
        {tags.map((tag) => (
          <div className="tag-row" key={tag.name}>
            <label className="tag-color" title={`Color for ${tag.name}`}>
              <span style={{ background: tag.color }} />
              <input
                type="color"
                aria-label={`Color for tag ${tag.name}`}
                value={tag.color}
                disabled={busy || (live && !canWrite)}
                onChange={(e) =>
                  save(
                    tags.map((t) =>
                      t.name === tag.name ? { ...t, color: e.target.value } : t,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="tag-track"
              aria-label={`Track ${tag.name}`}
              aria-pressed={trackedTag === tag.name}
              disabled={busy || (live && !canWrite)}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onTrack(trackedTag === tag.name ? null : tag.name);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span>{tag.name}</span>
              {trackedTag === tag.name && <Eye size={17} aria-hidden="true" />}
            </button>
            <button
              className="icon-button tag-edit"
              aria-label={`Edit tag ${tag.name}`}
              disabled={busy || (live && !canWrite)}
              onClick={() => {
                setEditing(editing === tag.name ? null : tag.name);
                setDeleting(null);
                setError("");
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button tag-delete"
              aria-label={`Delete tag ${tag.name}`}
              disabled={busy || (live && !canWrite)}
              onClick={() => {
                setDeleting(deleting === tag.name ? null : tag.name);
                setEditing(null);
                setError("");
              }}
            >
              <Trash2 size={14} />
            </button>
            {editing === tag.name && (
              <form
                className="tag-edit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() =>
                    onEdit(tag.name, {
                      name: String(f.get("name")).trim(),
                      color: String(f.get("color")),
                    }),
                  );
                }}
              >
                <label className="field">
                  Tag name
                  <input
                    name="name"
                    aria-label="Edit tag name"
                    defaultValue={tag.name}
                    required
                    maxLength={60}
                    autoFocus
                  />
                </label>
                <label>
                  Color{" "}
                  <input
                    type="color"
                    name="color"
                    aria-label="Edit tag color"
                    defaultValue={tag.color}
                  />
                </label>
                <div className="tag-form-actions">
                  <button className="primary-button" disabled={busy}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setEditing(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {deleting === tag.name && (
              <div className="tag-delete-confirm">
                <p>
                  Delete “{tag.name}”? This removes its assignments and
                  tracked-view selection. Events are kept.
                </p>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => run(() => onDelete(tag.name))}
                >
                  {busy ? "Deleting…" : "Delete tag"}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
        {adding && (
          <form
            className="tag-create"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form),
                name = String(f.get("name")).trim();
              if (tags.some((t) => t.name === name)) {
                setError("That tag already exists.");
                return;
              }
              if (
                await save([...tags, { name, color: String(f.get("color")) }])
              ) {
                form.reset();
                setAdding(false);
              }
            }}
          >
            <label>
              <span className="sr-only">Tag name</span>
              <input
                name="name"
                aria-label="Tag name"
                placeholder="Tag name"
                required
                maxLength={60}
                autoFocus
              />
            </label>
            <input
              type="color"
              name="color"
              aria-label="New tag color"
              defaultValue="#4b99d2"
            />
            <button
              className="icon-button"
              aria-label="Save tag"
              disabled={busy}
            >
              <Check size={18} />
            </button>
          </form>
        )}
        {syncNote && (
          <p className="sidebar-hint" role="status">
            {syncNote}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export function TagCountdowns({
  tags,
  events,
  live,
  canRead,
  accountKey,
  refresh,
  trackedTag,
  viewKey,
}: {
  tags: Tag[];
  events: CalendarEvent[];
  live: boolean;
  canRead: boolean;
  accountKey: string;
  refresh: number;
  trackedTag: string | null;
  viewKey: string;
}) {
  const [next, setNext] = useState<
    Record<string, { start: string; title: string } | null>
  >({});
  const [status, setStatus] = useState("");
  useEffect(() => {
    setNext({});
    try {
      setNext(
        JSON.parse(
          localStorage.getItem(
            `hypercal.countdowns.${accountKey}.${viewKey}`,
          ) || "{}",
        ),
      );
    } catch {}
  }, [accountKey, viewKey]);
  useEffect(() => {
    if (!live || !canRead || !trackedTag) return;
    let cancelled = false;
    setStatus("Updating tag countdowns");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api<{ next: typeof next; warnings: string[]; refreshing: boolean }>(
        `/tag-countdowns?view=${encodeURIComponent(viewKey)}`,
        { signal: AbortSignal.timeout(20000) },
      )
        .then((result) => {
          if (cancelled) return;
          setNext(result.next);
          setStatus(
            result.warnings.join(" ") ||
              (result.refreshing
                ? "Refreshing tagged events in the background"
                : ""),
          );
          localStorage.setItem(
            `hypercal.countdowns.${accountKey}.${viewKey}`,
            JSON.stringify(result.next),
          );
          if (result.refreshing) timer = setTimeout(load, 1500);
        })
        .catch(() => {
          if (!cancelled)
            setStatus(
              "Could not refresh tag countdowns. Showing saved values.",
            );
        });
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    live,
    canRead,
    accountKey,
    JSON.stringify(tags),
    refresh,
    trackedTag,
    viewKey,
  ]);

  // Re-render after midnight so a foreground app never keeps yesterday's count.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const now = new Date();
  const tracked = tags.filter((t) => t.name === trackedTag);
  if (!tracked.length) return null;
  return (
    <div className="header-tag-countdowns" aria-label="Tracked tag countdowns">
      {tracked.map((tag) => {
        const event = live
          ? next[tag.name]
          : events
              .filter(
                (e) => e.tags?.includes(tag.name) && new Date(e.end) > now,
              )
              .sort((a, b) => a.start.localeCompare(b.start))[0];
        const value = event
          ? countdown(new Date(event.start) < now ? now : event.start)
          : "—";
        return (
          <span
            key={tag.name}
            className="tag-countdown"
            style={{
              background: highlightColor(tag.color),
              color: pillInk(highlightColor(tag.color)),
            }}
            aria-label={`${tag.name}: ${event ? value + " until " + event.title : "no upcoming event"}`}
            title={
              event
                ? `${tag.name}: ${event.title}, ${event.start.slice(0, 10)}${status ? " · " + status : ""}`
                : `${tag.name}: no upcoming event${status ? " · " + status : ""}`
            }
          >
            {value}
          </span>
        );
      })}
      {status && (
        <span className="sr-only" role="status">
          {status}
        </span>
      )}
    </div>
  );
}
