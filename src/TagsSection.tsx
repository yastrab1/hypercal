import { useEffect, useState } from "react";
import { Plus, Check, Eye } from "lucide-react";
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
}: {
  tags: Tag[];
  live: boolean;
  canWrite: boolean;
  onChange: (tags: Tag[]) => Promise<void>;
  trackedTag: string | null;
  onTrack: (name: string | null) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
    <section className="tags-section" aria-label="Tags">
      <div className="section-label">
        <span>TAGS</span>
        <button
          className="icon-button"
          aria-label="Create tag"
          disabled={busy || (live && !canWrite)}
          onClick={() => setAdding(!adding)}
        >
          <Plus size={16} />
        </button>
      </div>
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
          <button className="icon-button" aria-label="Save tag" disabled={busy}>
            <Check size={18} />
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function TagCountdowns({
  tags,
  events,
  live,
  canWrite,
  accountKey,
  refresh,
  trackedTag,
  viewKey,
}: {
  tags: Tag[];
  events: CalendarEvent[];
  live: boolean;
  canWrite: boolean;
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
    if (!live || !canWrite || !trackedTag) return;
    let cancelled = false;
    setStatus("Updating tag countdowns");
    api<{ next: typeof next; warnings: string[] }>(
      `/tag-countdowns?view=${encodeURIComponent(viewKey)}`,
      {
        signal: AbortSignal.timeout(60000),
      },
    )
      .then((result) => {
        if (cancelled) return;
        setNext(result.next);
        setStatus(result.warnings.join(" "));
        localStorage.setItem(
          `hypercal.countdowns.${accountKey}.${viewKey}`,
          JSON.stringify(result.next),
        );
      })
      .catch(() => {
        if (!cancelled)
          setStatus("Could not refresh tag countdowns. Showing saved values.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    live,
    canWrite,
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
