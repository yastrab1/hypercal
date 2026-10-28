import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  endOfYear,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Command,
  SlidersHorizontal,
  ArrowUpRight,
  Check,
  Link,
  Keyboard,
  RefreshCw,
  Menu,
  Settings,
  LogOut,
  Trash2,
  Globe,
  LayoutGrid,
  Sun,
  CalendarRange,
  Calendar as CalendarIcon,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Pencil,
  ExternalLink,
  X,
  Moon,
  Monitor,
  Clock,
  MapPin,
  AlignLeft,
  Repeat2,
  Circle,
} from "lucide-react";
import type {
  Calendar,
  CalendarEvent,
  Layout,
  SavedView,
  Session,
} from "./types";
import { api, setCsrf } from "./api";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App as NativeApp } from "@capacitor/app";
import { calendarCache } from "./device";
import { useDrawerGesture } from "./useDrawerGesture";
import { usePeriodGesture } from "./usePeriodGesture";
import { EventPopover, DayOverflowPopover } from "./CalendarPopovers";
import { onDay } from "./Calendar";
import { demoCalendars, demoEvents, initialViews } from "./data";
import {
  filterEvents,
  getDefaultView,
  assignLayoutDefault,
} from "./domain.mjs";
import { CalendarCanvas, eventDate } from "./Calendar";
import { Panel } from "./Panel";
import { EventEditor } from "./EventEditor";
type Theme = "light" | "dark" | "system";
const layouts: Layout[] = ["day", "week", "month", "year"];
const labels: Record<Layout, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};
const layoutIcons = {
  day: Sun,
  week: CalendarRange,
  month: CalendarDays,
  year: LayoutGrid,
};
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const shortcutGroups = [
  {
    title: "Move around",
    items: [
      ["T", "Go to today"],
      ["J / N", "Next period"],
      ["K / P", "Previous period"],
      ["← / →", "Previous / next period"],
      ["G", "Go to a date"],
      ["D / W / M / Y", "Day / week / month / year"],
      ["1 – 9", "Open a saved view"],
    ],
  },
  {
    title: "Take action",
    items: [
      ["C", "Create an event"],
      ["⌘ / Ctrl K", "Open command palette"],
      ["/", "Search events"],
      ["⌘ / Ctrl ↵", "Save an editor"],
      ["Esc", "Close a panel"],
      ["?", "Keyboard shortcuts"],
    ],
  },
];
export default function App() {
  const [cachedStart] = useState(() => calendarCache.readLast());
  const [online, setOnline] = useState(navigator.onLine);
  const [verified, setVerified] = useState(false);
  const [usingCache, setUsingCache] = useState(!!cachedStart);
  const [syncFailed, setSyncFailed] = useState(false);
  const [metadataRefresh, setMetadataRefresh] = useState(0);
  const [dataAccount, setDataAccount] = useState(cachedStart?.user.id || null);
  const [desktop, setDesktop] = useState(
    () => matchMedia("(min-width: 761px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(min-width: 761px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const canEditViews = desktop && !Capacitor.isNativePlatform();
  const [theme, setTheme] = useState<Theme>(() =>
    stored("hypercal.theme", window.innerWidth < 761 ? "system" : "dark"),
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.style.colorScheme =
        document.documentElement.dataset.theme;
    };
    apply();
    localStorage.setItem("hypercal.theme", JSON.stringify(theme));
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const isDark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const [session, setSession] = useState<Session | null>(() =>
    cachedStart
      ? {
          connected: true,
          configured: true,
          user: cachedStart.user,
          csrf: "",
          appUrl: location.origin,
        }
      : null,
  );
  const [bootError, setBootError] = useState("");
  const [calendars, setCalendars] = useState<Calendar[]>(
    cachedStart?.calendars || demoCalendars,
  );
  const [events, setEvents] = useState<CalendarEvent[]>(() =>
    cachedStart
      ? Array.from(
          new Map(
            Object.values(cachedStart.ranges)
              .sort((a, b) => a.savedAt - b.savedAt)
              .flatMap((r) => r.events)
              .map((e) => [`${e.calendarId}:${e.id}`, e]),
          ).values(),
        )
      : stored("hypercal.demo.events", demoEvents()),
  );
  const [views, setViews] = useState<SavedView[]>(
    () => cachedStart?.views || stored("hypercal.demo.views", initialViews),
  );
  const [visible, setVisible] = useState<string[]>(
    (cachedStart?.calendars || demoCalendars).map((c) => c.id),
  );
  const [date, setDate] = useState(new Date());
  const [layout, setLayout] = useState<Layout>(() =>
    stored<Layout>(
      "hypercal.layout",
      window.innerWidth < 760 ? "month" : "week",
    ),
  );
  const [activeView, setActiveView] = useState<string | null>(
    () =>
      getDefaultView(
        cachedStart?.views || stored("hypercal.demo.views", initialViews),
        layout,
      )?.id || null,
  );
  const hasChosenView = useRef(false);
  const currentLayout = useRef(layout);
  currentLayout.current = layout;
  const [preview, setPreview] = useState<{
    event: CalendarEvent;
    anchor: HTMLElement;
  } | null>(null);
  const [expandedDay, setExpandedDay] = useState<{
    date: Date;
    anchor: HTMLElement;
  } | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const closeExpanded = useCallback(() => setExpandedDay(null), []);
  const [defaultError, setDefaultError] = useState("");
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [panel, setPanel] = useState<
    | "event"
    | "view"
    | "subscription"
    | "settings"
    | "shortcuts"
    | "palette"
    | "goto"
    | null
  >(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [newDate, setNewDate] = useState(new Date());
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState(
    cachedStart ? new Date(cachedStart.updatedAt).toISOString() : "",
  );
  const [search, setSearch] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [shortcuts, setShortcuts] = useState(() =>
    stored("hypercal.shortcuts", true),
  );
  const [refresh, setRefresh] = useState(0);
  const drawerRef = useRef<HTMLElement>(null);
  const shadeRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drawer = useDrawerGesture(
    !desktop && !panel && !preview && !expandedDay,
    sidebar,
    setSidebar,
    drawerRef,
    shadeRef,
  );
  useEffect(() => {
    if (desktop || !sidebar) return;
    const previous = document.activeElement as HTMLElement | null;
    const aside = drawerRef.current;
    aside?.querySelector<HTMLElement>("button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const controls = Array.from(
        aside?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)",
        ) || [],
      ).filter((el) => el.getClientRects().length);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [desktop, sidebar]);
  useEffect(() => {
    localStorage.setItem("hypercal.layout", JSON.stringify(layout));
  }, [layout]);
  const generation = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const live = !!session?.connected;
  const accountId = session?.user?.id;
  const canWrite = verified && online && !syncFailed;
  const active = views.find((v) => v.id === activeView);
  const selection = active ? active.calendarIds : visible;
  const from =
    layout === "year"
      ? startOfYear(date)
      : startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const to =
    layout === "year"
      ? addDays(endOfYear(date), 1)
      : addDays(endOfMonth(date), 8);
  const rangeKey = `${from.toISOString()}|${to.toISOString()}|${JSON.stringify([...selection].sort())}`;
  const displayFrom =
    layout === "day"
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
      : layout === "week"
        ? startOfWeek(date, { weekStartsOn: 1 })
        : from;
  const displayTo =
    layout === "day"
      ? addDays(displayFrom, 1)
      : layout === "week"
        ? addDays(displayFrom, 7)
        : layout === "year"
          ? startOfYear(addYears(date, 1))
          : addDays(startOfWeek(endOfMonth(date), { weekStartsOn: 1 }), 7);
  const filtered = filterEvents(
    events.filter(
      (e) =>
        selection.includes(e.calendarId) &&
        eventDate(e.start) < displayTo &&
        eventDate(e.end) > displayFrom,
    ),
    active,
    search,
  );
  const nativePoll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (nativePoll.current) clearInterval(nativePoll.current);
    },
    [],
  );
  async function connectGoogle() {
    if (!Capacitor.isNativePlatform()) {
      location.assign("/auth/google");
      return;
    }
    try {
      const data = await api<{ url: string }>("/native-auth/start", {
        method: "POST",
        body: "{}",
      });
      await Browser.open({ url: data.url });
      if (nativePoll.current) clearInterval(nativePoll.current);
      const started = Date.now();
      nativePoll.current = setInterval(async () => {
        if (Date.now() - started > 5 * 60000) {
          clearInterval(nativePoll.current!);
          setError("Google sign-in timed out. Please try again.");
          return;
        }
        try {
          const result = await api<{ connected: boolean }>(
            "/native-auth/claim",
            { method: "POST", body: "{}" },
          );
          if (result.connected) {
            clearInterval(nativePoll.current!);
            try {
              await Browser.close();
            } catch {}
            location.reload();
          }
        } catch (e) {
          clearInterval(nativePoll.current!);
          setError((e as Error).message);
        }
      }, 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const close = useCallback(() => setPanel(null), []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () => {
      if (panel) setPanel(null);
      else if (sidebar) setSidebar(false);
      else NativeApp.minimizeApp();
    });
    return () => {
      listener.then((x) => x.remove());
    };
  }, [panel, sidebar]);
  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4500);
  };
  const requestSync = useCallback(async () => {
    setOnline(navigator.onLine);
    if (!navigator.onLine) {
      setUsingCache(true);
      setSyncFailed(true);
      return;
    }
    try {
      const s = await api<Session>("/session");
      setCsrf(s.csrf);
      setSession(s);
      setVerified(true);
      setBootError("");
      if (!s.connected) {
        calendarCache.forget();
        setDataAccount(null);
        setCalendars(demoCalendars);
        setViews(stored("hypercal.demo.views", initialViews));
        setVisible(demoCalendars.map((c) => c.id));
        setEvents(stored("hypercal.demo.events", demoEvents()));
        setActiveView((current) => {
          const demoViews = stored<SavedView[]>(
            "hypercal.demo.views",
            initialViews,
          );
          return hasChosenView.current &&
            (current === null || demoViews.some((v) => v.id === current))
            ? current
            : getDefaultView(demoViews, currentLayout.current)?.id || null;
        });
        setUsingCache(false);
        setLastSync("");
      } else {
        setMetadataRefresh((n) => n + 1);
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      setVerified(false);
      setUsingCache(true);
      setSyncFailed(true);
      setBootError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    requestSync();
    if (new URLSearchParams(location.search).has("authError")) {
      setError(
        "Google sign-in was not completed. Open Connections to try again.",
      );
      history.replaceState({}, "", location.pathname);
    }
  }, [requestSync]);
  useEffect(() => {
    if (!live || !accountId) return;
    let cancelled = false;
    if (dataAccount !== accountId) {
      const saved = calendarCache.readAccount(accountId);
      setCalendars(saved?.calendars || []);
      setViews(saved?.views || []);
      setVisible((saved?.calendars || []).map((c) => c.id));
      setEvents(
        saved ? Object.values(saved.ranges).flatMap((r) => r.events) : [],
      );
      setActiveView(null);
      setDataAccount(accountId);
    }
    if (!verified || !online) return;
    Promise.all([api<Calendar[]>("/calendars"), api<SavedView[]>("/views")])
      .then(([c, v]) => {
        if (cancelled) return;
        setCalendars(c);
        setVisible((ids) => {
          const remaining = ids.filter((id) => c.some((x) => x.id === id));
          const added = c
            .filter((x) => !calendars.some((old) => old.id === x.id))
            .map((x) => x.id);
          return [...new Set([...remaining, ...added])];
        });
        setViews(v);
        setActiveView((current) =>
          !hasChosenView.current
            ? getDefaultView(v, layout)?.id || null
            : current && v.some((view) => view.id === current)
              ? current
              : null,
        );
        calendarCache.writeMetadata(session!.user!, c, v);
        setDataAccount(accountId);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setSyncFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // Metadata is refreshed on launch/resume and manual refresh, not on every local view edit.
  }, [live, accountId, verified, online, metadataRefresh]);
  useEffect(() => {
    if (
      !live ||
      !accountId ||
      dataAccount !== accountId ||
      calendars.some((c) => c.source === "demo")
    )
      return;
    const seq = ++generation.current;
    const saved = calendarCache.readRange(accountId, rangeKey);
    if (saved) {
      setEvents(saved.events);
      setLastSync(saved.refreshedAt);
      setUsingCache(true);
    }
    if (!verified || !online) return;
    setBusy(true);
    setError("");
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      calendars: JSON.stringify(selection),
    });
    api<{ events: CalendarEvent[]; warnings: string[]; refreshedAt: string }>(
      `/events?${query}`,
    )
      .then((data) => {
        if (seq !== generation.current) return;
        setEvents(data.events);
        setWarnings(data.warnings);
        setLastSync(data.refreshedAt);
        setUsingCache(false);
        setSyncFailed(false);
        calendarCache.writeRange(
          session!.user!,
          rangeKey,
          data.events,
          data.refreshedAt,
        );
      })
      .catch((e) => {
        if (seq === generation.current) {
          setError(e.message);
          setUsingCache(true);
          setSyncFailed(true);
        }
      })
      .finally(() => {
        if (seq === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, [
    live,
    accountId,
    dataAccount,
    verified,
    online,
    rangeKey,
    refresh,
    calendars,
  ]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") requestSync();
    };
    const onOnline = () => requestSync();
    const onOffline = () => {
      setOnline(false);
      setUsingCache(true);
      setSyncFailed(true);
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        setRefresh((n) => n + 1);
    }, 60000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onVisible);
    const nativeListener = Capacitor.isNativePlatform()
      ? NativeApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) requestSync();
        })
      : null;
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onVisible);
      nativeListener?.then((listener) => listener.remove());
    };
  }, [requestSync]);
  useEffect(() => {
    if (live && verified && accountId === dataAccount && session?.user)
      calendarCache.writeMetadata(session.user, calendars, views);
    else if (!live && verified) {
      localStorage.setItem("hypercal.demo.events", JSON.stringify(events));
      localStorage.setItem("hypercal.demo.views", JSON.stringify(views));
    }
  }, [events, views, calendars, live, verified, accountId, dataAccount]);
  const move = useCallback(
    (step: number) => {
      setPreview(null);
      setExpandedDay(null);
      setDate((d) =>
        layout === "year"
          ? addYears(d, step)
          : layout === "month"
            ? addMonths(d, step)
            : addDays(d, layout === "week" ? step * 7 : step),
      );
    },
    [layout],
  );
  usePeriodGesture(
    surfaceRef,
    !desktop && !sidebar && !panel && !preview && !expandedDay,
    move,
  );
  const openCreate = (d = new Date()) => {
    setPreview(null);
    setExpandedDay(null);
    if (d.getHours() === 0) d.setHours(9, 0, 0, 0);
    setNewDate(d);
    setEditingEvent(null);
    setPanel("event");
  };
  const chooseView = (v: SavedView) => {
    hasChosenView.current = true;
    setPreview(null);
    setExpandedDay(null);
    setActiveView(v.id);
    setLayout(v.layout);
    setSidebar(false);
  };
  const changeLayout = (l: Layout) => {
    hasChosenView.current = true;
    setPreview(null);
    setExpandedDay(null);
    setLayout(l);
    setActiveView(getDefaultView(views, l)?.id || null);
  };
  async function saveLayoutDefault(l: Layout, id: string | null) {
    setDefaultError("");
    setDefaultSaving(true);
    try {
      if (live && !canWrite)
        throw new Error("Connect and sync before changing a default.");
      const updated = live
        ? await api<SavedView[]>(`/view-defaults/${l}`, {
            method: "PATCH",
            body: JSON.stringify({ viewId: id }),
          })
        : assignLayoutDefault(views, l, id);
      setViews(updated);
      if (layout === l) setActiveView(id);
    } catch (e) {
      setDefaultError((e as Error).message);
    } finally {
      setDefaultSaving(false);
    }
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPanel((p) => (p === "palette" ? null : "palette"));
        return;
      }
      if (!shortcuts || e.ctrlKey || e.metaKey || e.altKey || e.isComposing)
        return;
      if (e.key === "Escape" && sidebar) {
        e.preventDefault();
        setSidebar(false);
        return;
      }
      if (e.key === "Escape" && (preview || expandedDay)) {
        e.preventDefault();
        if (preview) setPreview(null);
        else setExpandedDay(null);
        return;
      }
      const t = e.target as HTMLElement;
      if (
        t.closest('input,textarea,select,[contenteditable="true"]') ||
        panel ||
        preview ||
        expandedDay
      )
        return;
      const key = e.key.toLowerCase();
      if (
        [
          "t",
          "j",
          "n",
          "k",
          "p",
          "d",
          "w",
          "m",
          "y",
          "c",
          "/",
          "?",
          "g",
          "arrowleft",
          "arrowright",
        ].includes(key) ||
        /^[1-9]$/.test(key)
      )
        e.preventDefault();
      else return;
      if (key === "t") setDate(new Date());
      else if (["j", "n"].includes(key)) move(1);
      else if (["k", "p"].includes(key)) move(-1);
      else if (key === "arrowleft") move(-1);
      else if (key === "arrowright") move(1);
      else if (["d", "w", "m", "y"].includes(key))
        changeLayout(
          (
            { d: "day", w: "week", m: "month", y: "year" } as Record<
              string,
              Layout
            >
          )[key],
        );
      else if (key === "c") openCreate(new Date(date));
      else if (key === "/") searchRef.current?.focus();
      else if (key === "?") setPanel("shortcuts");
      else if (key === "g") setPanel("goto");
      else {
        const v = views[Number(key) - 1];
        if (v) chooseView(v);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  async function saveEvent(draft: CalendarEvent, recurrence: string) {
    if (!live) {
      setEvents((es) =>
        editingEvent
          ? es.map((e) => (e.id === draft.id ? draft : e))
          : [...es, { ...draft, id: crypto.randomUUID(), source: "demo" }],
      );
      close();
      flash("Saved in demo. Connect Google to save to your calendar.");
      return;
    }
    if (!canWrite)
      throw new Error("Connect and finish syncing before saving changes.");
    const payload = {
      ...draft,
      recurrence: editingEvent ? undefined : recurrence,
    };
    await api(
      editingEvent ? `/events/${encodeURIComponent(draft.id)}` : "/events",
      {
        method: editingEvent ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    calendarCache.invalidateEvents(accountId!);
    setRefresh((n) => n + 1);
    close();
    flash("Saved to Google Calendar.");
  }
  async function deleteEvent(e: CalendarEvent) {
    if (live && !canWrite)
      throw new Error("Connect and finish syncing before deleting events.");
    if (live)
      await api(`/events/${encodeURIComponent(e.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ calendarId: e.calendarId, etag: e.etag }),
      });
    else setEvents((es) => es.filter((x) => x.id !== e.id));
    if (live) {
      calendarCache.invalidateEvents(accountId!);
      setEvents((es) =>
        es.filter((x) => !(x.id === e.id && x.calendarId === e.calendarId)),
      );
    }
    setRefresh((n) => n + 1);
    setPreview(null);
    setExpandedDay(null);
    close();
    flash(live ? "Deleted from Google Calendar." : "Demo event deleted.");
  }
  async function copyEvent(source: CalendarEvent, destinationId: string) {
    const destination = calendars.find(
      (c) =>
        c.id === destinationId && !c.readOnly && c.id !== source.calendarId,
    );
    if (!destination)
      throw new Error("Choose a different calendar you can write to.");
    if (live && !canWrite)
      throw new Error("Connect and sync before copying events.");
    if (!live) {
      const { etag, htmlLink, recurring, ...details } = source;
      setEvents((events) => [
        ...events,
        {
          ...details,
          id: crypto.randomUUID(),
          calendarId: destinationId,
          source: "demo",
          readOnly: false,
        },
      ]);
    } else {
      if (source.source === "google")
        await api(`/events/${encodeURIComponent(source.id)}/copy`, {
          method: "POST",
          body: JSON.stringify({
            calendarId: source.calendarId,
            destinationCalendarId: destinationId,
            etag: source.etag,
          }),
        });
      else
        await api("/events", {
          method: "POST",
          body: JSON.stringify({
            calendarId: destinationId,
            title: source.title,
            description: source.description,
            location: source.location,
            start: source.start,
            end: source.end,
            allDay: source.allDay,
            timeZone: source.timeZone,
            reminderMinutes: source.reminderMinutes,
          }),
        });
      calendarCache.invalidateEvents(accountId!);
      setRefresh((n) => n + 1);
    }
    setPreview(null);
    setExpandedDay(null);
    flash(`Copied to ${destination.name}${live ? "." : " in demo."}`);
  }
  async function saveView(v: SavedView) {
    if (live && !canWrite)
      throw new Error("Connect and sync before saving a view.");
    if (live) {
      const saved = await api<SavedView>(
        editingView ? `/views/${v.id}` : "/views",
        { method: editingView ? "PATCH" : "POST", body: JSON.stringify(v) },
      );
      setViews((vs) => {
        const next = editingView
          ? vs.map((x) => (x.id === v.id ? saved : x))
          : [...vs, saved];
        return saved.isDefault
          ? assignLayoutDefault(next, saved.layout, saved.id)
          : next;
      });
      chooseView(saved);
    } else {
      const saved = { ...v, id: editingView ? v.id : crypto.randomUUID() };
      setViews((vs) => {
        const next = editingView
          ? vs.map((x) => (x.id === v.id ? saved : x))
          : [...vs, saved];
        return saved.isDefault
          ? assignLayoutDefault(next, saved.layout, saved.id)
          : next;
      });
      chooseView(saved);
    }
    close();
    flash("View saved. Your events are unchanged.");
  }
  async function deleteView(v: SavedView) {
    if (live && !canWrite)
      throw new Error("Connect and sync before deleting a view.");
    if (live) await api(`/views/${v.id}`, { method: "DELETE" });
    setViews((vs) => vs.filter((x) => x.id !== v.id));
    if (activeView === v.id) setActiveView(null);
    close();
  }
  const monthStart = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const headerTitle =
    layout === "year" ? format(date, "yyyy") : format(date, "MMMM yyyy");
  const commands = [
    {
      name: "Switch to dark mode",
      key: "",
      action: () => {
        setTheme("dark");
        close();
      },
    },
    {
      name: "Switch to light mode",
      key: "",
      action: () => {
        setTheme("light");
        close();
      },
    },
    {
      name: "Use device theme",
      key: "",
      action: () => {
        setTheme("system");
        close();
      },
    },
    {
      name: "Create event",
      key: "C",
      action: () => openCreate(new Date(date)),
    },
    {
      name: "Go to today",
      key: "T",
      action: () => {
        setDate(new Date());
        close();
      },
    },
    { name: "Go to a date", key: "G", action: () => setPanel("goto") },
    ...layouts.map((l) => ({
      name: `Show ${labels[l].toLowerCase()} view`,
      key: l[0].toUpperCase(),
      action: () => {
        changeLayout(l);
        close();
      },
    })),
    ...views.map((v, i) => ({
      name: `Open ${v.name}`,
      key: i < 9 ? String(i + 1) : "",
      action: () => {
        chooseView(v);
        close();
      },
    })),
    ...(canEditViews
      ? [
          {
            name: "Create a custom view",
            key: "",
            action: () => {
              setEditingView(null);
              setPanel("view");
            },
          },
        ]
      : []),
    {
      name: "Connections & settings",
      key: "",
      action: () => setPanel("settings"),
    },
    {
      name: "Keyboard shortcuts",
      key: "?",
      action: () => setPanel("shortcuts"),
    },
  ];
  return (
    <div
      className={`app-shell ${Capacitor.isNativePlatform() ? "native" : ""}`}
    >
      <aside
        ref={drawerRef}
        style={!desktop ? { width: drawer.width } : undefined}
        className={`sidebar ${sidebar ? "open" : ""} ${drawer.dragging ? "dragging" : ""}`}
        inert={!desktop && !sidebar}
      >
        <a className="brand" href="/" aria-label="HyperCal home">
          <span className="brand-symbol">H</span>
          <span>
            HyperCal<span className="brand-period">.</span>
          </span>
          <small>PREVIEW</small>
        </a>
        <div className="drawer-account">
          {" "}
          <button
            className="account-button"
            onClick={() => setPanel("settings")}
          >
            <span className={`avatar ${live ? "connected" : ""}`}>
              {live ? session?.user?.email[0].toUpperCase() : "H"}
            </span>
            <span>
              <strong>
                {live ? session?.user?.email : "Your Google Calendar"}
              </strong>
              <small>
                {live ? "Google connected" : "Connect Google Calendar"}
              </small>
            </span>
            <Settings size={16} />
          </button>
        </div>
        <button
          className="drawer-close icon-button"
          aria-label="Close navigation drawer"
          onClick={() => setSidebar(false)}
        >
          <X size={22} />
        </button>
        <nav className="drawer-layouts" aria-label="Calendar layouts">
          {layouts.map((l) => {
            const Icon = layoutIcons[l];
            return (
              <button
                key={l}
                className={layout === l ? "selected" : ""}
                onClick={() => {
                  changeLayout(l);
                  setSidebar(false);
                }}
              >
                <Icon size={22} />
                <span>{labels[l]}</span>
              </button>
            );
          })}
        </nav>
        <button
          className="create-button"
          onClick={() => openCreate(new Date(date))}
        >
          <Plus size={19} />
          <span>Create event</span>
          <kbd>C</kbd>
        </button>
        <section className="mini-picker">
          <header>
            <strong>{format(date, "MMMM yyyy")}</strong>
            <div>
              <button
                className="icon-button"
                aria-label="Previous month"
                onClick={() => setDate((d) => addMonths(d, -1))}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Next month"
                onClick={() => setDate((d) => addMonths(d, 1))}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </header>
          <div className="mini-grid">
            {["M", "T", "W", "T", "F", "S", "S"].map((x, i) => (
              <span key={i} className="mini-weekday">
                {x}
              </span>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const d = addDays(monthStart, i);
              return (
                <button
                  key={i}
                  className={`${isSameDay(d, new Date()) ? "today " : ""}${isSameDay(d, date) ? "selected " : ""}${!isSameMonth(d, date) ? "muted" : ""}`}
                  tabIndex={isSameDay(d, date) ? 0 : -1}
                  data-picker-date={format(d, "yyyy-MM-dd")}
                  onKeyDown={(e) => {
                    const delta = (
                      {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -7,
                        ArrowDown: 7,
                      } as Record<string, number>
                    )[e.key];
                    if (!delta) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const target = addDays(d, delta);
                    const picker = e.currentTarget.closest(".mini-picker");
                    setDate(target);
                    requestAnimationFrame(() =>
                      picker
                        ?.querySelector<HTMLButtonElement>(
                          `[data-picker-date="${format(target, "yyyy-MM-dd")}"]`,
                        )
                        ?.focus(),
                    );
                  }}
                  onClick={() => {
                    setDate(d);
                    changeLayout("day");
                    setSidebar(false);
                  }}
                  aria-label={format(d, "EEEE, MMMM d")}
                >
                  {format(d, "d")}
                </button>
              );
            })}
          </div>
        </section>
        <nav className="views-nav">
          <div className="section-label">
            <span>MY VIEWS</span>
            <button
              className="icon-button web-only"
              aria-label="Create custom view"
              onClick={() => {
                setEditingView(null);
                setPanel("view");
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          <button
            className={`view-link ${!activeView ? "active" : ""}`}
            onClick={() => {
              setActiveView(null);
              setSidebar(false);
            }}
          >
            <CalendarDays size={17} />
            <span>All calendars</span>
          </button>
          {views.map((v, i) => (
            <div
              className={`view-item ${activeView === v.id ? "active" : ""}`}
              key={v.id}
            >
              <button className="view-link" onClick={() => chooseView(v)}>
                <SlidersHorizontal size={16} />
                <span>{v.name}</span>
                <kbd>{i < 9 ? i + 1 : ""}</kbd>
              </button>
              <button
                className="view-edit web-only"
                aria-label={`Edit ${v.name}`}
                onClick={() => {
                  setEditingView(v);
                  setPanel("view");
                }}
              >
                <Pencil size={13} />
              </button>
            </div>
          ))}
        </nav>
        <section className="calendar-list">
          <div className="section-label">
            <span>CALENDARS</span>
            <button
              className="icon-button"
              aria-label="Add subscription"
              onClick={() => setPanel("subscription")}
            >
              <Plus size={16} />
            </button>
          </div>
          {calendars.map((c) => (
            <label key={c.id} className="calendar-toggle">
              <input
                type="checkbox"
                checked={selection.includes(c.id)}
                onChange={() => {
                  setActiveView(null);
                  setVisible(
                    selection.includes(c.id)
                      ? selection.filter((id) => id !== c.id)
                      : [...selection, c.id],
                  );
                }}
                style={{ accentColor: c.color }}
              />
              <span>{c.name}</span>
              {c.source === "ical" && <Link size={12} />}
            </label>
          ))}
          <button
            className="subtle-link"
            onClick={() => setPanel("subscription")}
          >
            <Link size={14} /> Add calendar by URL
          </button>
        </section>
        <div className="sidebar-bottom">
          <button
            className="sidebar-command"
            onClick={() => setPanel("palette")}
          >
            <Command size={16} />
            <span>Commands</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            className="sidebar-command"
            onClick={() => setPanel("shortcuts")}
          >
            <Keyboard size={16} />
            <span>Keyboard shortcuts</span>
            <kbd>?</kbd>
          </button>
        </div>
      </aside>
      <button
        ref={shadeRef}
        className={`sidebar-shade ${sidebar || drawer.dragging ? "visible" : ""}`}
        aria-label="Close navigation"
        aria-hidden={!sidebar && !drawer.dragging}
        tabIndex={-1}
        onClick={() => setSidebar(false)}
      />
      <main className="workspace" inert={!desktop && sidebar}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <div className="date-tools">
            <button
              className="today-button"
              onClick={() => setDate(new Date())}
            >
              Today
            </button>
            <div className="nav-arrows">
              <button
                className="icon-button"
                aria-label="Previous period"
                onClick={() => move(-1)}
              >
                <ChevronLeft size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Next period"
                onClick={() => move(1)}
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </div>
          <button
            className="mobile-month-title"
            onClick={() => setPanel("goto")}
          >
            {format(date, "MMMM")} <ChevronRight size={14} />
          </button>
          <h1>{headerTitle}</h1>
          <div className="mobile-header-actions">
            <SyncIndicator
              busy={busy}
              cached={usingCache}
              online={online}
              onRefresh={requestSync}
            />
            <button
              className="icon-button"
              aria-label="Search events"
              onClick={() => setPanel("palette")}
            >
              <Search size={21} />
            </button>
            <button
              className="mobile-today"
              aria-label="Go to today"
              onClick={() => setDate(new Date())}
            >
              {format(new Date(), "d")}
            </button>
            <button
              className={`avatar ${live ? "connected" : ""}`}
              aria-label="Google account and settings"
              onClick={() => setPanel("settings")}
            >
              {live ? session?.user?.email[0].toUpperCase() : "H"}
            </button>
          </div>
          <div className="header-tools">
            <button
              className="icon-button"
              aria-label="Search and commands"
              title="Commands (Ctrl K)"
              onClick={() => setPanel("palette")}
            >
              <Search size={20} />
            </button>
            <SyncIndicator
              busy={busy}
              cached={usingCache}
              online={online}
              onRefresh={requestSync}
            />
            <button
              className="icon-button"
              aria-label={
                isDark ? "Switch to light mode" : "Switch to dark mode"
              }
              title="Toggle light / dark mode"
              onClick={() =>
                setTheme(
                  document.documentElement.dataset.theme === "dark"
                    ? "light"
                    : "dark",
                )
              }
            >
              {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <select
              className="layout-select"
              aria-label="Calendar layout"
              value={layout}
              onChange={(e) => changeLayout(e.target.value as Layout)}
            >
              {layouts.map((l) => (
                <option key={l} value={l}>
                  {labels[l]}
                </option>
              ))}
            </select>
            <select
              className="perspective-select"
              aria-label={`View for ${layout} layout`}
              value={activeView || ""}
              onChange={(e) => {
                hasChosenView.current = true;
                setActiveView(e.target.value || null);
              }}
            >
              <option value="">
                All calendars
                {!getDefaultView(views, layout) ? " · default" : ""}
              </option>
              {views
                .filter((v) => v.layout === layout)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.isDefault ? " · default" : ""}
                  </option>
                ))}
            </select>
            <button
              className="connection-pill"
              onClick={() => setPanel("settings")}
            >
              <span className={live ? "status-dot live" : "status-dot"} />
              {live ? "Connected" : "Connect Google"}
              <ArrowUpRight size={14} />
            </button>
          </div>
        </header>
        {!live && (
          <div className="demo-banner">
            <span className="demo-tag">DEMO</span>
            <span>Sample calendars. Changes stay in this browser.</span>
            <button onClick={() => setPanel("settings")}>
              Connect your calendar <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        {(bootError || error) && (
          <div className="error-banner" role="alert">
            <AlertCircle size={16} />
            <span>
              {bootError ? `Backend unavailable: ${bootError}` : error}
            </span>
            <button
              onClick={() => {
                setError("");
                if (bootError) requestSync();
                else setRefresh((n) => n + 1);
              }}
            >
              Retry
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="warning-banner" role="status">
            <AlertCircle size={15} />
            {warnings.join(" ")}
          </div>
        )}
        {active && (
          <div className="active-view-bar">
            <span>
              <SlidersHorizontal size={14} /> {active.name}{" "}
              <span className="muted">
                · {selection.length} calendars
                {active.exclude ? ` · excludes “${active.exclude}”` : ""}
                {active.include ? ` · matches “${active.include}”` : ""}
              </span>
            </span>
            <button
              className="web-only"
              onClick={() => {
                setEditingView(active);
                setPanel("view");
              }}
            >
              Edit view
            </button>
          </div>
        )}
        <div className="search-row">
          <Search size={14} />
          <input
            ref={searchRef}
            aria-label="Filter visible events"
            placeholder="Filter visible events…"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setSearch("");
                e.currentTarget.blur();
              }
            }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X size={14} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
          <span>{filtered.length} events</span>
        </div>
        <div ref={surfaceRef} className="calendar-surface" aria-busy={busy}>
          <CalendarCanvas
            layout={layout}
            date={date}
            events={filtered}
            calendars={calendars}
            onEvent={(e, anchor) => setPreview({ event: e, anchor })}
            onExpandDay={(d, anchor) => {
              setPreview(null);
              setExpandedDay({ date: d, anchor });
            }}
            onCreate={openCreate}
            onDate={(d, l) => {
              setDate(d);
              if (l) changeLayout(l);
            }}
          />
          {!busy && filtered.length === 0 && (
            <div className="empty-note">
              {search
                ? "No events match your search."
                : selection.length
                  ? "A little breathing room. Click a time to add an event."
                  : "Choose a calendar in the sidebar to see events."}
            </div>
          )}
        </div>
        <button
          className="mobile-create-fab"
          aria-label="Create event"
          onClick={() => openCreate(new Date(date))}
        >
          <Plus size={29} />
        </button>
        <footer className="workspace-footer">
          <span>
            <span className="status-dot" />
            {live
              ? lastSync
                ? `${usingCache ? (!online ? "Offline · saved" : "Saved") : "Updated"} ${format(new Date(lastSync), usingCache ? "MMM d, HH:mm" : "HH:mm")} · ${busy ? "syncing…" : "sync on open"}`
                : "Loading Google calendars…"
              : "Sample data · changes stay in this browser"}
          </span>
          <button onClick={() => setPanel("shortcuts")}>
            <kbd>?</kbd> Shortcuts
          </button>
          <span className="footer-zone">
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </span>
        </footer>
      </main>
      {expandedDay && (
        <DayOverflowPopover
          date={expandedDay.date}
          anchor={expandedDay.anchor}
          events={filtered.filter((e) => onDay(e, expandedDay.date))}
          calendars={calendars}
          onClose={closeExpanded}
          onEvent={(event, anchor) => setPreview({ event, anchor })}
          onOpenDay={() => {
            setDate(expandedDay.date);
            changeLayout("day");
          }}
        />
      )}
      {preview && (
        <EventPopover
          key={`${preview.event.calendarId}:${preview.event.id}`}
          event={preview.event}
          anchor={preview.anchor}
          calendar={calendars.find((c) => c.id === preview.event.calendarId)}
          calendars={calendars}
          actionsDisabled={live && !canWrite}
          onDelete={() => deleteEvent(preview.event)}
          onCopy={(destination) => copyEvent(preview.event, destination)}
          onClose={closePreview}
          onEdit={() => {
            setEditingEvent(preview.event);
            setPreview(null);
            setExpandedDay(null);
            setPanel("event");
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {panel === "event" && (
        <Panel
          variant="event"
          title={
            editingEvent
              ? editingEvent.readOnly
                ? "Event details"
                : "Edit event"
              : "New event"
          }
          onClose={close}
        >
          <EventEditor
            event={editingEvent}
            date={newDate}
            calendars={calendars}
            live={live}
            offline={live && !canWrite}
            email={session?.user?.email}
            onClose={close}
            onSave={saveEvent}
            onDelete={deleteEvent}
          />
        </Panel>
      )}
      {panel === "view" && canEditViews && (
        <Panel
          title={editingView ? "Edit custom view" : "Create a custom view"}
          onClose={close}
        >
          <ViewEditor
            view={editingView}
            calendars={calendars}
            visible={selection}
            layout={layout}
            onSave={saveView}
            onDelete={deleteView}
          />
        </Panel>
      )}
      {panel === "subscription" && (
        <Panel title="Subscribe to a calendar" onClose={close}>
          <SubscriptionEditor
            live={live}
            calendars={calendars}
            onConnect={() => setPanel("settings")}
            onAdded={(c) => {
              setCalendars((cs) => [...cs, c]);
              setVisible((ids) => [...ids, c.id]);
              setActiveView(null);
              close();
              flash("Calendar added. URL feeds refresh every five minutes.");
            }}
            onRemove={async (id) => {
              await api(`/subscriptions/${id}`, { method: "DELETE" });
              setCalendars((cs) => cs.filter((c) => c.id !== id));
              setVisible((ids) => ids.filter((x) => x !== id));
              flash("Subscription removed.");
            }}
          />
        </Panel>
      )}
      {panel === "settings" && (
        <Panel title="Connections & settings" onClose={close}>
          <div className="settings-section">
            <span className="integration-icon">
              <CalendarDays size={26} />
            </span>
            <h3>Google Calendar, with perspective.</h3>
            <p>
              Keep Google as your calendar. Use HyperCal to see it your way.
              Event changes are saved directly to Google; changes from Google
              appear on refresh.
            </p>
            {live ? (
              <>
                <div className="connected-account">
                  <CheckCircle2 size={18} />
                  <span>{session?.user?.email}</span>
                </div>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    try {
                      await api("/logout", { method: "POST" });
                      calendarCache.forget();
                      location.reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <LogOut size={15} /> Sign out of HyperCal
                </button>
              </>
            ) : session?.configured ? (
              <button className="primary-button" onClick={connectGoogle}>
                <Globe size={17} /> Continue with Google{" "}
                <ArrowUpRight size={15} />
              </button>
            ) : (
              <>
                <div className="setup-note">
                  <strong>One setup step remaining</strong>
                  <p>
                    Add a Google Cloud <b>Web application</b> OAuth client to
                    the backend configuration. Enable the Calendar API and add
                    your account as a test user.
                  </p>
                  <label>Authorized redirect URI</label>
                  <code>
                    {session?.appUrl || location.origin}/auth/google/callback
                  </code>
                  <small>
                    Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in R2D2’s
                    private .env file, then restart HyperCal.
                  </small>
                </div>
                <button className="secondary-button" onClick={close}>
                  Keep exploring the demo
                </button>
              </>
            )}
          </div>
          <div className="settings-divider" />
          <label className="field">
            Appearance
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
            >
              <option value="system">Use device theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <small>
              Saved on this device. Both themes use your Google calendar colors.
            </small>
          </label>
          <div className="settings-divider" />
          {canEditViews && (
            <section className="layout-default-settings">
              <h3>Default views</h3>
              <p>
                Opening a layout uses its default filters. Clicking a date
                always opens the default Day view.
              </p>
              {layouts.map((l) => (
                <label className="field" key={l}>
                  {labels[l]}
                  <select
                    aria-label={`Default ${l} view`}
                    disabled={defaultSaving}
                    value={getDefaultView(views, l)?.id || ""}
                    onChange={(e) =>
                      saveLayoutDefault(l, e.target.value || null)
                    }
                  >
                    <option value="">All calendars</option>
                    {views
                      .filter((v) => v.layout === l)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              {defaultError && (
                <p className="form-error" role="alert">
                  {defaultError}
                </p>
              )}
              <small className="muted">
                Defaults save automatically to your account.
              </small>
              <div className="settings-divider" />
            </section>
          )}
          <label className="settings-toggle">
            <span>
              <strong>Single-key shortcuts</strong>
              <small>
                Navigate with D, W, M, Y and create with C. Turn off for screen
                readers that reserve these keys.
              </small>
            </span>
            <input
              type="checkbox"
              checked={shortcuts}
              onChange={(e) => {
                setShortcuts(e.target.checked);
                localStorage.setItem(
                  "hypercal.shortcuts",
                  JSON.stringify(e.target.checked),
                );
              }}
            />
          </label>
          <div className="settings-divider" />
          <h3>Coming later: shared views</h3>
          <p>
            Invite friends with Google sign-in. Each member chooses calendars to
            contribute. Private invitation links and read-only links are
            planned; nothing is shared yet.
          </p>
        </Panel>
      )}
      {panel === "shortcuts" && (
        <Panel title="Keep your hands on the keys" onClose={close} wide>
          <p className="panel-description">
            A few keys. A much calmer calendar.
          </p>
          {shortcutGroups.map((g) => (
            <section className="shortcut-group" key={g.title}>
              <h3>{g.title}</h3>
              {g.items.map(([key, label]) => (
                <div key={key}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </section>
          ))}
          <p className="small muted">
            Shortcuts pause while you type or edit. Tab moves through controls;
            Enter opens focused events. You can disable single-key shortcuts in
            settings.
          </p>
        </Panel>
      )}
      {panel === "palette" && (
        <Panel title="What would you like to do?" onClose={close} wide>
          <CommandPalette
            commands={commands}
            events={filtered}
            onEvent={(e) => {
              setPanel(null);
              if (surfaceRef.current)
                setPreview({ event: e, anchor: surfaceRef.current });
            }}
          />
        </Panel>
      )}
      {panel === "goto" && (
        <Panel title="Go to a date" onClose={close} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("date") as string;
              if (value) {
                setDate(new Date(value + "T12:00:00"));
                close();
              }
            }}
          >
            <label className="field">
              Date
              <input
                autoFocus
                required
                name="date"
                type="date"
                defaultValue={format(date, "yyyy-MM-dd")}
              />
            </label>
            <button className="primary-button" type="submit">
              Go to date <ArrowUpRight size={16} />
            </button>
          </form>
        </Panel>
      )}
    </div>
  );
}
function ViewEditor({
  view,
  calendars,
  visible,
  layout,
  onSave,
  onDelete,
}: {
  view: SavedView | null;
  calendars: Calendar[];
  visible: string[];
  layout: Layout;
  onSave: (v: SavedView) => Promise<void>;
  onDelete: (v: SavedView) => Promise<void>;
}) {
  const [ids, setIds] = useState(view?.calendarIds || visible);
  const [viewLayout, setViewLayout] = useState<Layout>(view?.layout || layout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!busy) form.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [busy]);
  return (
    <form
      ref={form}
      className="editor-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          await onSave({
            id: view?.id || "",
            name: String(f.get("name")),
            layout: f.get("layout") as Layout,
            calendarIds: ids,
            include: String(f.get("include")),
            exclude: String(f.get("exclude")),
            hideAllDay: f.get("hideAllDay") === "on",
            isDefault: f.get("isDefault") === "on",
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="panel-description">
        A different perspective on the same events. Filters only change what you
        see.
      </p>
      <fieldset disabled={busy}>
        <label className="field">
          View name
          <input
            autoFocus
            name="name"
            defaultValue={view?.name}
            placeholder="e.g. Monthly highlights"
            required
            maxLength={60}
          />
        </label>
        <label className="field">
          Calendar layout
          <select
            name="layout"
            value={viewLayout}
            onChange={(e) => setViewLayout(e.target.value as Layout)}
          >
            {layouts.map((l) => (
              <option key={l} value={l}>
                {labels[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={view?.isDefault}
          />
          Use as the default {labels[viewLayout].toLowerCase()} view
        </label>
        <span className="field-label">Include calendars</span>
        <div className="view-calendar-picker">
          {calendars.map((c) => (
            <label key={c.id} className="calendar-toggle">
              <input
                type="checkbox"
                style={{ accentColor: c.color }}
                checked={ids.includes(c.id)}
                onChange={() =>
                  setIds((xs) =>
                    xs.includes(c.id)
                      ? xs.filter((x) => x !== c.id)
                      : [...xs, c.id],
                  )
                }
              />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
        <label className="field">
          Only show events matching
          <input
            name="include"
            defaultValue={view?.include}
            placeholder="e.g. exam, deadline"
            maxLength={200}
          />
          <small>
            Match any comma-separated phrase in title, notes, or location. Leave
            blank for all.
          </small>
        </label>
        <label className="field">
          Hide events matching
          <input
            name="exclude"
            defaultValue={view?.exclude}
            placeholder="e.g. lecture, seminar"
            maxLength={200}
          />
          <small>
            Useful for keeping recurring lessons out of a monthly overview.
          </small>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="hideAllDay"
            defaultChecked={view?.hideAllDay}
          />
          Hide all-day events
        </label>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="primary-button" disabled={busy} type="submit">
          <Check size={16} />
          Save view
        </button>
        {view && (
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={async () => {
              if (!deleting) {
                setDeleting(true);
                return;
              }
              setBusy(true);
              try {
                await onDelete(view);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={15} />
            {deleting ? "Confirm delete" : "Delete"}
          </button>
        )}
      </div>
      <div className="inline-note">
        <Link size={14} />
        Private to you. Shared views are planned.
      </div>
    </form>
  );
}
function SubscriptionEditor({
  live,
  calendars,
  onConnect,
  onAdded,
  onRemove,
}: {
  live: boolean;
  calendars: Calendar[];
  onConnect: () => void;
  onAdded: (c: Calendar) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  return (
    <>
      <p className="panel-description">
        Bring in your school timetable, holidays, or any public iCalendar feed
        or .ics file. Subscriptions and imports are read-only and stay in
        HyperCal.
      </p>
      {!live ? (
        <>
          <div className="inline-note">
            Connect Google first to save a subscription to your account.
          </div>
          <button className="primary-button" onClick={onConnect}>
            Set up Google connection <ArrowUpRight size={16} />
          </button>
        </>
      ) : (
        <form
          className="editor-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              if (importFile && importFile.size > 4 * 1024 * 1024)
                throw new Error("Choose a calendar file smaller than 4 MB.");
              const body = importFile
                ? {
                    name: f.get("name"),
                    color: f.get("color"),
                    text: await importFile.text(),
                  }
                : Object.fromEntries(f);
              const c = await api<Calendar>(
                importFile ? "/imports" : "/subscriptions",
                { method: "POST", body: JSON.stringify(body) },
              );
              onAdded(c);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <label className="field">
              Calendar name
              <input
                autoFocus
                name="name"
                required
                placeholder="School timetable"
                maxLength={80}
              />
            </label>
            <label className="field">
              iCal / subscription URL
              <input
                name="url"
                required={!importFile}
                disabled={!!importFile}
                placeholder="https://example.com/calendar.ics"
                maxLength={4000}
              />
              <small>
                Public https://, http://, and webcal:// links are supported.
              </small>
            </label>
            <label className="field">
              Or import an iCalendar file
              <input
                type="file"
                accept=".ics,text/calendar"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
              <small>
                Imports are a one-time snapshot. A URL subscription stays up to
                date.
              </small>
            </label>
            <label className="field">
              Calendar color
              <input type="color" name="color" defaultValue="#168675" />
            </label>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}{" "}
            {busy
              ? "Reading calendar…"
              : importFile
                ? "Import calendar"
                : "Add subscription"}
          </button>
        </form>
      )}
      {calendars.some((c) => c.source === "ical") && (
        <section className="subscription-list">
          <h3>Your subscriptions</h3>
          {calendars
            .filter((c) => c.source === "ical")
            .map((c) => (
              <div key={c.id}>
                <span>{c.name}</span>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={async () => {
                    if (removeId !== c.id) {
                      setRemoveId(c.id);
                      return;
                    }
                    setBusy(true);
                    try {
                      await onRemove(c.id);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {removeId === c.id ? "Confirm remove" : "Remove"}
                </button>
              </div>
            ))}
        </section>
      )}
    </>
  );
}
function CommandPalette({
  commands,
  events,
  onEvent,
}: {
  commands: { name: string; key: string; action: () => void }[];
  events: CalendarEvent[];
  onEvent: (e: CalendarEvent) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const items = [
    ...commands.filter((c) =>
      c.name.toLowerCase().includes(query.toLowerCase()),
    ),
    ...(query
      ? events
          .filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 12)
          .map((e) => ({
            name: e.title,
            key: format(eventDate(e.start), "MMM d"),
            action: () => onEvent(e),
          }))
      : []),
  ];
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return (
    <div className="command-palette">
      <div className="palette-input">
        <Search size={20} />
        <input
          autoFocus
          role="combobox"
          aria-label="Search commands and visible events"
          aria-controls="command-list"
          aria-expanded="true"
          aria-activedescendant={items[index] ? `command-${index}` : undefined}
          placeholder="Search commands or events…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, items.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && items[index]) {
              e.preventDefault();
              items[index].action();
            }
          }}
        />
      </div>
      <div
        className="palette-results"
        role="listbox"
        id="command-list"
        ref={list}
      >
        {items.map((c, i) => (
          <button
            type="button"
            role="option"
            aria-selected={index === i}
            id={`command-${i}`}
            data-index={i}
            className={index === i ? "highlighted" : ""}
            key={i}
            onClick={c.action}
            onMouseMove={() => setIndex(i)}
          >
            <span>{c.name}</span>
            <kbd>{c.key}</kbd>
          </button>
        ))}
        {!items.length && (
          <p className="muted">No matching commands or visible events.</p>
        )}
      </div>
      <div className="palette-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> select
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </div>
    </div>
  );
}

function SyncIndicator({
  busy,
  cached,
  online,
  onRefresh,
}: {
  busy: boolean;
  cached: boolean;
  online: boolean;
  onRefresh: () => void;
}) {
  const label = busy
    ? "Syncing calendars"
    : !online
      ? "Offline · showing saved events"
      : cached
        ? "Showing saved events · tap to sync"
        : "Calendars up to date · tap to refresh";
  return (
    <button
      className={`sync-indicator ${busy ? "sync-active" : ""}`}
      onClick={onRefresh}
      aria-label={label}
      title={label}
    >
      <RefreshCw size={14} />
      <span className="sr-only" role="status">
        {label}
      </span>
    </button>
  );
}
