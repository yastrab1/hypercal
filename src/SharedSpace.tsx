import { useEventStream } from "./useEventStream";
import {
  mergeEventChunk,
  prefetchWindow,
  reuseRecords,
} from "./event-stream.mjs";
import { CalendarViewport } from "./CalendarViewport";
import { usePeriodGesture } from "./usePeriodGesture";
import { useCallback, useEffect, useRef, useState } from "react";
import { addMonths, addYears, format } from "date-fns";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Settings,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import { CalendarCanvas, onDay } from "./Calendar";
import { EventPopover, DayOverflowPopover } from "./CalendarPopovers";
import { Panel } from "./Panel";
import { continuousRange, monthRange, shiftPeriod } from "./period.mjs";
import type { Calendar, CalendarEvent, Layout } from "./types";
export type SharedRoute = {
  kind: "hub" | "view" | "invite" | "public";
  id?: string;
};
export interface SharedView {
  id: string;
  name: string;
  layout: Layout;
  include: string;
  exclude: string;
  hideAllDay: boolean;
  continuousScroll?: boolean;
  isOwner: boolean;
  members: {
    id: string;
    email: string;
    isYou: boolean;
    isOwner: boolean;
    contributions: Contribution[];
  }[];
  invitations: { id: string; email: string; expiresAt: number }[];
  links: { id: string; scope: "web" | "ical"; expiresAt: number }[];
}
interface Contribution {
  calendarId: string;
  detail: "busy" | "titles" | "details";
  publicAllowed: boolean;
}
export function sharedRouteFromLocation(): SharedRoute | null {
  const query = new URLSearchParams(location.hash.slice(1));
  if (query.has("share")) return { kind: "public", id: query.get("share")! };
  if (query.has("invite")) {
    sessionStorage.setItem("hypercal.pendingInvite", query.get("invite")!);
    return { kind: "invite", id: query.get("invite")! };
  }
  if (query.has("shared")) return { kind: "view", id: query.get("shared")! };
  const pending = sessionStorage.getItem("hypercal.pendingInvite");
  return pending ? { kind: "invite", id: pending } : null;
}
export function clearSharedRoute() {
  sessionStorage.removeItem("hypercal.pendingInvite");
  history.replaceState(null, "", location.pathname + location.search);
}
const labels: Layout[] = ["day", "week", "month", "year"];
export function SharedSpace({
  route,
  connected,
  calendars,
  draft,
  onConnect,
  onClose,
}: {
  route: SharedRoute;
  connected: boolean;
  calendars: Calendar[];
  draft: {
    name: string;
    layout: Layout;
    include: string;
    exclude: string;
    hideAllDay: boolean;
    continuousScroll?: boolean;
  };
  onConnect: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<SharedView[]>([]),
    [view, setView] = useState<SharedView | null>(null);
  const [current, setCurrent] = useState(
      route.kind === "view" ? route.id : null,
    ),
    [inviteName, setInviteName] = useState(""),
    [joined, setJoined] = useState(false);
  const [scrollFocus, setScrollFocus] = useState<Date | null>(null);
  const approachDate = useCallback(
    (next: Date) =>
      setScrollFocus((old) => (old?.getTime() === next.getTime() ? old : next)),
    [],
  );
  const [date, setDate] = useState(new Date()),
    [layout, setLayout] = useState<Layout>("month");
  const [data, setData] = useState<{
    name?: string;
    layout?: Layout;
    continuousScroll?: boolean;
    events: CalendarEvent[];
    calendars: Calendar[];
    warnings: string[];
  }>({ events: [], calendars: [], warnings: [] });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [manage, setManage] = useState(false),
    [preview, setPreview] = useState<{
      event: CalendarEvent;
      anchor: HTMLElement;
    } | null>(null),
    [creating, setCreating] = useState(false);
  const [adjacent, setAdjacent] = useState(false),
    [expanded, setExpanded] = useState<{
      date: Date;
      anchor: HTMLElement;
    } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null),
    publicLoaded = useRef(false);
  const continuous =
    ["month", "week"].includes(layout) &&
    !!(route.kind === "public"
      ? data.continuousScroll
      : view?.continuousScroll);
  const eventStream = useEventStream({
    enabled:
      continuous && (route.kind === "public" || (!!current && connected)),
    context: `shared:${route.kind}:${route.id}:${current}`,
    refresh,
    window: prefetchWindow(
      scrollFocus || (layout === "month" ? monthRange(date).from : date),
      layout,
    ),
    load: (chunk, signal) =>
      api(
        `${route.kind === "public" ? `/shared-links/${encodeURIComponent(route.id!)}` : `/shared-views/${current}/events`}?${new URLSearchParams({ from: chunk.from.toISOString(), to: chunk.to.toISOString() })}`,
        { signal },
      ),
    onChunk: (batch, chunk) =>
      setData((old) => ({
        ...old,
        events: mergeEventChunk(
          old.events,
          batch.events,
          chunk.from,
          chunk.to,
          [
            ...new Set(
              [...old.events, ...batch.events].map((e) => e.calendarId),
            ),
          ],
        ),
        calendars: batch.calendars
          ? reuseRecords(old.calendars, batch.calendars)
          : old.calendars,
        warnings: batch.warnings,
      })),
  });
  useEffect(() => {
    if (continuous && eventStream.error)
      setData((old) => ({ ...old, events: [], calendars: [] }));
  }, [eventStream.error, continuous]);
  const move = useCallback(
    (step: number) => {
      setPreview(null);
      setExpanded(null);
      setDate((d) => shiftPeriod(d, layout, step));
    },
    [layout],
  );
  const publicMode = route.kind === "public";
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.isComposing ||
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"]',
        ) ||
        manage
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (preview) setPreview(null);
        else if (expanded) setExpanded(null);
        else onClose();
        return;
      }
      if (preview || expanded || (!publicMode && !current)) return;
      if (["ArrowLeft", "k", "p"].includes(e.key)) {
        e.preventDefault();
        move(-1);
      }
      if (["ArrowRight", "j", "n"].includes(e.key)) {
        e.preventDefault();
        move(1);
      }
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        setDate(new Date());
      }
      const next = (
        { d: "day", w: "week", m: "month", y: "year" } as Record<string, Layout>
      )[e.key.toLowerCase()];
      if (next) {
        e.preventDefault();
        setLayout(next);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [manage, preview, expanded, publicMode, current, move, onClose]);
  usePeriodGesture(
    surfaceRef,
    !continuous &&
      window.innerWidth <= 760 &&
      (publicMode || !!current) &&
      !manage &&
      !preview &&
      !expanded,
    move,
    setAdjacent,
  );
  useEffect(() => {
    if (connected && !publicMode)
      api<SharedView[]>("/shared-views")
        .then(setItems)
        .catch((e) => setError(e.message));
  }, [connected, publicMode, refresh]);
  useEffect(() => {
    if (route.kind === "invite" && !joined)
      api<{ name: string }>(
        `/shared-invitations/${encodeURIComponent(route.id!)}`,
      )
        .then((v) => setInviteName(v.name))
        .catch((e) => setError(e.message));
  }, [route.id, joined]);
  useEffect(() => {
    if (!current || !connected) return;
    let cancelled = false;
    api<SharedView>(`/shared-views/${current}`)
      .then((v) => {
        if (!cancelled) {
          setView(v);
          setLayout(v.layout);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [current, connected, refresh]);
  useEffect(() => {
    if (!publicMode && (!current || !connected)) return;
    if (continuous) {
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError("");
    setPreview(null);
    const { from, to } = continuous
      ? continuousRange(date, layout)
      : monthRange(date, true);
    const query = new URLSearchParams({
      from: (layout === "year"
        ? new Date(date.getFullYear(), 0, 1)
        : from
      ).toISOString(),
      to: (layout === "year"
        ? new Date(date.getFullYear() + 1, 0, 1)
        : to
      ).toISOString(),
    });
    const load = () =>
      api<typeof data>(
        `${publicMode ? `/shared-links/${encodeURIComponent(route.id!)}` : `/shared-views/${current}/events`}?${query}`,
      )
        .then((v) => {
          if (!cancelled) {
            setData(v);
            if (publicMode && !publicLoaded.current) {
              publicLoaded.current = true;
              if (v.layout) setLayout(v.layout);
            }
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setData({ events: [], calendars: [], warnings: [] });
            setError(e.message);
          }
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    load();
    const timer = setInterval(load, 60000);
    const visible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [
    publicMode,
    route.id,
    current,
    connected,
    date,
    layout,
    refresh,
    continuous,
  ]);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const name = String(new FormData(e.currentTarget).get("name"));
      const v = await api<SharedView>("/shared-views", {
        method: "POST",
        body: JSON.stringify({ ...draft, name }),
      });
      setCurrent(v.id);
      setView(v);
      setCreating(false);
      setManage(true);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const open = (v: SharedView) => {
    setCurrent(v.id);
    setView(v);
    setLayout(v.layout);
    setError("");
    history.replaceState(null, "", `#shared=${v.id}`);
  };
  return (
    <main className="shared-space">
      <header className="shared-toolbar">
        <button
          className="icon-button"
          aria-label="Back to my calendar"
          onClick={onClose}
        >
          <ArrowLeft size={21} />
        </button>
        <h1>
          {publicMode
            ? data.name || "Shared calendar"
            : view?.name || "Shared views"}
        </h1>
        {(publicMode || current) && (
          <>
            <button
              className="icon-button"
              aria-label="Previous period"
              onClick={() => setDate((d) => shiftPeriod(d, layout, -1))}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="Next period"
              onClick={() => setDate((d) => shiftPeriod(d, layout, 1))}
            >
              <ChevronRight size={19} />
            </button>
            <select
              aria-label="Shared calendar layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value as Layout)}
            >
              {labels.map((l) => (
                <option key={l} value={l}>
                  {l[0].toUpperCase() + l.slice(1)}
                </option>
              ))}
            </select>
          </>
        )}
        {connected && !publicMode && current && (
          <>
            <button
              className="icon-button"
              aria-label="Shared view settings"
              onClick={() => setManage(true)}
            >
              <Settings size={20} />
            </button>
            <button
              className="shared-list-button"
              onClick={() => {
                setCurrent(null);
                setView(null);
              }}
            >
              All shared views
            </button>
          </>
        )}
      </header>
      {continuous && eventStream.error && (
        <div className="warning-banner" role="status">
          Events could not load. {eventStream.error}
          <button onClick={() => setRefresh((n) => n + 1)}>Retry</button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setRefresh((n) => n + 1)}>Retry</button>
        </div>
      )}
      {!publicMode && route.kind === "invite" && !joined ? (
        <section className="sharing-intro">
          <Users size={30} />
          <h2>
            {inviteName ? `Join ${inviteName}` : "Shared view invitation"}
          </h2>
          <p>
            Sign in with the Google account this invitation was addressed to.
            Joining does not share any of your calendars.
          </p>
          {!connected ? (
            <button className="primary-button" onClick={onConnect}>
              Continue with Google
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={busy || !inviteName}
              onClick={async () => {
                setBusy(true);
                try {
                  const v = await api<SharedView>(
                    `/shared-invitations/${encodeURIComponent(route.id!)}/accept`,
                    { method: "POST" },
                  );
                  sessionStorage.removeItem("hypercal.pendingInvite");
                  setJoined(true);
                  open(v);
                  setManage(true);
                  setRefresh((n) => n + 1);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Join shared view
            </button>
          )}
        </section>
      ) : !publicMode && !connected ? (
        <section className="sharing-intro">
          <h2>Plan together</h2>
          <p>
            Connect Google to create shared views, invite friends and choose
            calendars to contribute.
          </p>
          <button className="primary-button" onClick={onConnect}>
            Continue with Google
          </button>
        </section>
      ) : !publicMode && !current ? (
        <section className="shared-hub">
          <h2>Your shared views</h2>
          {items.length === 0 && (
            <p className="muted">
              Create a view, then invite people and choose calendars to share.
            </p>
          )}
          {items.map((v) => (
            <button
              className="shared-view-entry"
              key={v.id}
              onClick={() => open(v)}
            >
              <Users size={20} />
              <span>
                <strong>{v.name}</strong>
                <small>
                  {v.members.length} members · {v.layout}
                </small>
              </span>
            </button>
          ))}
          <button
            className="secondary-button"
            onClick={() => setCreating(true)}
          >
            <Plus size={16} />
            Share current view
          </button>
          {creating && (
            <form onSubmit={create} className="shared-create">
              <label className="field">
                View name
                <input
                  autoFocus
                  name="name"
                  defaultValue={draft.name}
                  required
                  maxLength={60}
                />
              </label>
              <p className="small muted">
                Starts with your current {draft.layout} view’s filters. No
                calendars are shared until you choose contributions.
              </p>
              <button disabled={busy} className="primary-button">
                Create shared view
              </button>
            </form>
          )}
        </section>
      ) : (
        <>
          <div className="shared-date-line">
            <strong>
              {format(
                date,
                layout === "day" ? "EEEE, MMMM d, yyyy" : "MMMM yyyy",
              )}
            </strong>
            <span>
              {publicMode ? "Read-only link" : "Shared view"}
              {busy || (continuous && eventStream.busy) ? " · Syncing…" : ""}
            </span>
          </div>
          {data.warnings.map((w) => (
            <div key={w} className="warning-banner">
              {w}
            </div>
          ))}
          <div ref={surfaceRef} className="shared-calendar calendar-surface">
            <div className="period-track">
              {adjacent &&
                [-1, 1].map((step) => (
                  <div
                    key={step}
                    inert
                    aria-hidden="true"
                    className={`period-page ${step < 0 ? "period-before" : "period-after"}`}
                  >
                    <CalendarCanvas
                      readOnly
                      layout={layout}
                      date={shiftPeriod(date, layout, step)}
                      calendars={data.calendars}
                      events={data.events}
                      onEvent={() => {}}
                      onExpandDay={() => {}}
                      onCreate={() => {}}
                      onDate={() => {}}
                    />
                  </div>
                ))}
              <div className="period-page period-current">
                <CalendarViewport
                  continuous={continuous}
                  onApproach={approachDate}
                  onViewportDate={(next) => {
                    setPreview(null);
                    setExpanded(null);
                    setDate(next);
                  }}
                  readOnly
                  layout={layout}
                  date={date}
                  calendars={data.calendars}
                  events={data.events}
                  onEvent={(event, anchor) => setPreview({ event, anchor })}
                  onExpandDay={(date, anchor) => setExpanded({ date, anchor })}
                  onCreate={() => {}}
                  onDate={(d, l) => {
                    setDate(d);
                    if (l) setLayout(l);
                  }}
                />
              </div>
            </div>
            {!busy &&
              !(continuous && eventStream.busy) &&
              !error &&
              !data.events.length && (
                <p className="shared-empty">
                  No shared events in this period. Contributors choose what to
                  share in view settings.
                </p>
              )}
          </div>
        </>
      )}
      {expanded && (
        <DayOverflowPopover
          date={expanded.date}
          anchor={expanded.anchor}
          events={data.events.filter((e) => onDay(e, expanded.date))}
          calendars={data.calendars}
          onClose={() => setExpanded(null)}
          onEvent={(event, anchor) => setPreview({ event, anchor })}
          onOpenDay={() => {
            setDate(expanded.date);
            setLayout("day");
            setExpanded(null);
          }}
        />
      )}
      {preview && (
        <EventPopover
          event={preview.event}
          anchor={preview.anchor}
          calendar={data.calendars.find(
            (c) => c.id === preview.event.calendarId,
          )}
          calendars={[]}
          actionsDisabled
          onClose={() => setPreview(null)}
          onEdit={() => {}}
          onDelete={async () => {}}
          onCopy={async () => {}}
        />
      )}
      {manage && view && (
        <Panel title="Shared view settings" onClose={() => setManage(false)}>
          <SharedSettings
            key={view.id}
            view={view}
            calendars={calendars}
            onUpdate={(v) => {
              setView(v);
              setRefresh((n) => n + 1);
            }}
            onRemoved={() => {
              setCurrent(null);
              setView(null);
              setManage(false);
              setRefresh((n) => n + 1);
            }}
          />
        </Panel>
      )}
    </main>
  );
}
function SharedSettings({
  view,
  calendars,
  onUpdate,
  onRemoved,
}: {
  view: SharedView;
  calendars: Calendar[];
  onUpdate: (v: SharedView) => void;
  onRemoved: () => void;
}) {
  const me = view.members.find((m) => m.isYou)!;
  const [selected, setSelected] = useState<Contribution[]>(me.contributions),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [generated, setGenerated] = useState(""),
    [message, setMessage] = useState(""),
    [deleting, setDeleting] = useState(false);
  useEffect(
    () => setSelected(view.members.find((m) => m.isYou)?.contributions || []),
    [view],
  );
  async function update(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      const next = await api<SharedView>(`/shared-views/${view.id}`);
      onUpdate(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const base = `/shared-views/${view.id}`;
  return (
    <div className="shared-settings">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
      {generated && (
        <div className="generated-share-link" role="status">
          <label className="field">
            Copy this link now
            <input
              readOnly
              aria-label="Generated share link"
              value={generated}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <button
            className="secondary-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(generated);
                setMessage("Link copied.");
              } catch {
                setMessage("Select the link and copy it.");
              }
            }}
          >
            <Copy size={15} />
            Copy link
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss generated link"
            onClick={() => setGenerated("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <h3>People with access</h3>
      {view.members.map((m) => (
        <div className="shared-member" key={m.id}>
          <span>
            {m.email}
            <small>{m.isOwner ? "Owner" : m.isYou ? "You" : "Member"}</small>
          </span>
          {!m.isOwner && (view.isOwner || m.isYou) && (
            <button
              disabled={busy}
              className="subtle-link"
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`${base}/members/${m.id}`, { method: "DELETE" });
                  if (m.isYou) onRemoved();
                  else onUpdate(await api<SharedView>(base));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {m.isYou ? "Leave" : "Remove"}
            </button>
          )}
        </div>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await update(`${base}/contributions`, "PUT", {
              contributions: selected,
            })
          )
            setMessage("Calendar contributions saved.");
        }}
      >
        <h3>Your calendar contributions</h3>
        <p className="small muted">
          Members can see only the calendars and detail level you choose. Busy
          is the initial detail level.
        </p>
        <fieldset disabled={busy}>
          {calendars
            .filter((c) => c.source === "google")
            .map((c) => {
              const contribution = selected.find((x) => x.calendarId === c.id);
              return (
                <div className="contribution" key={c.id}>
                  <label className="calendar-toggle">
                    <input
                      type="checkbox"
                      checked={!!contribution}
                      onChange={(e) =>
                        setSelected((cs) =>
                          e.target.checked
                            ? [
                                ...cs,
                                {
                                  calendarId: c.id,
                                  detail: "busy",
                                  publicAllowed: false,
                                },
                              ]
                            : cs.filter((x) => x.calendarId !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                  {contribution && (
                    <>
                      <select
                        aria-label={`Detail for ${c.name}`}
                        value={contribution.detail}
                        onChange={(e) =>
                          setSelected((cs) =>
                            cs.map((x) =>
                              x.calendarId === c.id
                                ? {
                                    ...x,
                                    detail: e.target
                                      .value as Contribution["detail"],
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="busy">Busy times only</option>
                        <option value="titles">Titles and times</option>
                        <option value="details">
                          Titles, times, notes and locations
                        </option>
                      </select>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={contribution.publicAllowed}
                          onChange={(e) =>
                            setSelected((cs) =>
                              cs.map((x) =>
                                x.calendarId === c.id
                                  ? { ...x, publicAllowed: e.target.checked }
                                  : x,
                              ),
                            )
                          }
                        />
                        Allow in public links, with titles and times at most
                      </label>
                    </>
                  )}
                </div>
              );
            })}
          <button className="primary-button" type="submit">
            Save contributions
          </button>
        </fieldset>
      </form>
      {view.isOwner && (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const r = await api<{ url: string }>(`${base}/invitations`, {
                  method: "POST",
                  body: JSON.stringify({
                    email: new FormData(e.currentTarget).get("email"),
                  }),
                });
                setGenerated(r.url);
                onUpdate(await api<SharedView>(base));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Invite a friend</h3>
            <label className="field">
              Google account email
              <input type="email" name="email" required maxLength={254} />
            </label>
            <p className="small muted">
              Copy the invitation link and send it yourself. It expires in 7
              days and works once, for this Google account only.
            </p>
            <button className="secondary-button" disabled={busy}>
              Create invitation link
            </button>
          </form>
          {view.invitations.map((i) => (
            <div className="shared-member" key={i.id}>
              <span>
                {i.email}
                <small>Pending invitation</small>
              </span>
              <button
                disabled={busy}
                className="subtle-link"
                onClick={() => update(`${base}/invitations/${i.id}`, "DELETE")}
              >
                Revoke
              </button>
            </div>
          ))}
          <section>
            <h3>Read-only export links</h3>
            <p className="small muted">
              Anyone with a link and access to this server can read calendars
              whose contributors opted into public links. Notes, locations and
              email addresses are excluded. Links expire after 30 days. Calendar
              clients may retain previously downloaded events after revocation.
            </p>
            <div className="form-actions">
              {(["web", "ical"] as const).map((scope) => (
                <button
                  className="secondary-button"
                  key={scope}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await api<{ url: string }>(`${base}/links`, {
                        method: "POST",
                        body: JSON.stringify({ scope }),
                      });
                      setGenerated(r.url);
                      onUpdate(await api<SharedView>(base));
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {scope === "web"
                    ? "Create view link"
                    : "Export iCalendar link"}
                </button>
              ))}
            </div>
            {view.links.map((l) => (
              <div className="shared-member" key={l.id}>
                <span>
                  {l.scope === "web"
                    ? "Read-only web link"
                    : "iCalendar subscription"}
                  <small>
                    Expires {format(new Date(l.expiresAt), "MMM d")}
                  </small>
                </span>
                <button
                  className="subtle-link"
                  disabled={busy}
                  onClick={() => update(`${base}/links/${l.id}`, "DELETE")}
                >
                  Revoke
                </button>
              </div>
            ))}
          </section>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await update(base, "PATCH", {
                name: f.get("name"),
                layout: f.get("layout"),
                include: f.get("include"),
                exclude: f.get("exclude"),
                hideAllDay: f.get("hideAllDay") === "on",
                continuousScroll: f.get("continuousScroll") === "on",
              });
            }}
          >
            <h3>View definition</h3>
            <label className="field">
              Name
              <input
                name="name"
                required
                defaultValue={view.name}
                maxLength={60}
              />
            </label>
            <label className="field">
              Layout
              <select name="layout" defaultValue={view.layout}>
                {labels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-field continuous-option">
              <input
                type="checkbox"
                name="continuousScroll"
                defaultChecked={view.continuousScroll}
              />
              <span>
                Continuous scrolling{" "}
                <small>
                  Experimental. Month snaps by week row; week scrolls through
                  individual days.
                </small>
              </span>
            </label>
            <label className="field">
              Only show matching
              <input
                name="include"
                defaultValue={view.include}
                maxLength={500}
              />
            </label>
            <label className="field">
              Hide matching
              <input
                name="exclude"
                defaultValue={view.exclude}
                maxLength={500}
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                name="hideAllDay"
                defaultChecked={view.hideAllDay}
              />
              Hide all-day events
            </label>
            <button className="secondary-button" disabled={busy}>
              Save shared view
            </button>
          </form>
          <button
            className="danger-button"
            disabled={busy}
            onClick={async () => {
              if (!deleting) {
                setDeleting(true);
                return;
              }
              setBusy(true);
              try {
                await api(base, { method: "DELETE" });
                onRemoved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {deleting ? "Confirm delete shared view" : "Delete shared view"}
          </button>
        </>
      )}
    </div>
  );
}
