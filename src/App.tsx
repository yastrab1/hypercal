import { useEventStream } from "./useEventStream";
import {
  mergeEventChunk,
  prefetchWindow,
  reuseRecords,
} from "./event-stream.mjs";
import { CalendarViewport } from "./CalendarViewport";
import { RecurrenceDialog, type RecurrenceScope } from "./RecurrenceDialog";
import { TagsSection, TagCountdowns } from "./TagsSection";
import { cleanTags } from "./tags.mjs";
import {
  SharedSpace,
  sharedRouteFromLocation,
  clearSharedRoute,
  type SharedView,
  type SharedRoute,
} from "./SharedSpace";
import { NotificationDefaults } from "./NotificationPicker";
import { continuousRange, monthRange, shiftPeriod } from "./period.mjs";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Users,
  ChevronDown,
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
  Tag,
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
      ["Ctrl/Cmd F / /", "Filter visible events"],
      ["⌘ / Ctrl ↵", "Save an editor"],
      ["Esc", "Close a panel"],
      ["?", "Keyboard shortcuts"],
    ],
  },
];
export default function App() {
  const [sharedRoute, setSharedRoute] = useState<SharedRoute | null>(
    sharedRouteFromLocation,
  );
  const [sharedViews, setSharedViews] = useState<SharedView[]>([]);
  useEffect(() => {
    const update = () => setSharedRoute(sharedRouteFromLocation());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
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
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagTracking, setTagTracking] = useState<Record<string, string | null>>(
    {},
  );
  const [calendarsCollapsed, setCalendarsCollapsed] = useState(() =>
    stored("hypercal.calendarsCollapsed", true),
  );
  const [notificationDefault, setNotificationDefault] = useState("calendar");
  useEffect(() => {
    setNotificationDefault(
      session?.notificationDefault ??
        stored<string>(
          `hypercal.notificationDefault.${session?.user?.id || "demo"}`,
          "calendar",
        ),
    );
  }, [session?.user?.id, session?.notificationDefault]);
  const [bootError, setBootError] = useState("");
  const [calendars, setCalendars] = useState<Calendar[]>(
    cachedStart?.calendars ||
      stored<Calendar[]>("hypercal.demo.calendars", demoCalendars),
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
    (
      cachedStart?.calendars ||
      stored<Calendar[]>("hypercal.demo.calendars", demoCalendars)
    ).map((c) => c.id),
  );
  const [date, setDate] = useState(new Date());
  const [scrollFocus, setScrollFocus] = useState<Date | null>(null);
  const approachDate = useCallback(
    (next: Date) =>
      startTransition(() =>
        setScrollFocus((old) =>
          old?.getTime() === next.getTime() ? old : next,
        ),
      ),
    [],
  );
  const [periodPreview, setPeriodPreview] = useState(false);
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
  const [dayEvents, setDayEvents] = useState<CalendarEvent[] | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState("");
  useEffect(() => {
    setDayEvents(null);
    setDayError("");
    if (!expandedDay || !session?.connected || !verified || !online) {
      setDayLoading(false);
      return;
    }
    let cancelled = false;
    setDayLoading(true);
    const start = new Date(expandedDay.date);
    start.setHours(0, 0, 0, 0);
    const query = new URLSearchParams({
      from: start.toISOString(),
      to: addDays(start, 1).toISOString(),
      calendars: JSON.stringify(calendars.map((c) => c.id).slice(0, 40)),
    });
    api<{ events: CalendarEvent[]; warnings: string[] }>(`/events?${query}`)
      .then((result) => {
        if (!cancelled) {
          setDayEvents(result.events);
          setDayError(result.warnings.join(" "));
        }
      })
      .catch((e) => {
        if (!cancelled) setDayError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    expandedDay?.date.getTime(),
    session?.connected,
    verified,
    online,
    calendars,
  ]);
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
    | "find"
    | null
  >(null);
  const [recurrenceRequest, setRecurrenceRequest] = useState<{
    action: "edit" | "delete";
    resolve: (scope: RecurrenceScope | null) => void;
  } | null>(null);
  const requestScope = (
    event: CalendarEvent | null,
    action: "edit" | "delete",
  ): Promise<RecurrenceScope | null> =>
    event?.recurring
      ? new Promise((resolve) => setRecurrenceRequest({ action, resolve }))
      : Promise.resolve("instance");
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [newDate, setNewDate] = useState(new Date());
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() =>
    stored("hypercal.sidebarCollapsed", false),
  );
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
  const live = !!session?.connected;
  const accountId = session?.user?.id;
  const canWrite = verified && online && !syncFailed;
  const tagAccount = session?.user?.id || "demo";
  const tagViewKey = activeView ? `view:${activeView}` : `layout:${layout}`;
  const trackedTag = tagTracking[tagViewKey] || null;
  useEffect(() => {
    setTags(stored<Tag[]>(`hypercal.tags.${tagAccount}`, []));
    setTagTracking(stored(`hypercal.tagTracking.${tagAccount}`, {}));
    if (!live || !verified || !online) return;
    let cancelled = false;
    Promise.all([
      api<Tag[]>("/tags"),
      api<Record<string, string | null>>("/tag-tracking"),
    ])
      .then(([values, tracking]) => {
        if (cancelled) return;
        setTagTracking(tracking);
        localStorage.setItem(
          `hypercal.tagTracking.${tagAccount}`,
          JSON.stringify(tracking),
        );
        if (cancelled) return;
        setTags(values);
        localStorage.setItem(
          `hypercal.tags.${tagAccount}`,
          JSON.stringify(values),
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tagAccount, live, verified, online, metadataRefresh]);
  async function saveTags(values: Tag[]) {
    if (live && !canWrite)
      throw new Error("Connect and sync before changing tags.");
    const result = live
      ? await api<Tag[]>("/tags", {
          method: "PUT",
          body: JSON.stringify(values),
        })
      : values;
    if (result.length > 40) throw new Error("Create up to 40 tags.");
    localStorage.setItem(`hypercal.tags.${tagAccount}`, JSON.stringify(result));
    setTags(result);
  }

  async function changeTag(oldName: string, replacement: Tag | null) {
    if (live && !canWrite)
      throw new Error("Connect and sync before changing tags.");
    if (
      replacement &&
      replacement.name !== oldName &&
      tags.some((t) => t.name === replacement.name)
    )
      throw new Error("That tag already exists.");
    const result = live
      ? await api<{
          tags: Tag[];
          tracking: Record<string, string | null>;
          pending: boolean;
        }>(`/tags/${encodeURIComponent(oldName)}`, {
          method: replacement ? "PATCH" : "DELETE",
          body: replacement ? JSON.stringify(replacement) : undefined,
        })
      : {
          tags: replacement
            ? tags.map((t) => (t.name === oldName ? replacement : t))
            : tags.filter((t) => t.name !== oldName),
          tracking: Object.fromEntries(
            Object.entries(tagTracking).map(([key, value]) => [
              key,
              value === oldName ? replacement?.name || null : value,
            ]),
          ),
          pending: false,
        };
    setTags(result.tags);
    setTagTracking(result.tracking);
    localStorage.setItem(
      `hypercal.tags.${tagAccount}`,
      JSON.stringify(result.tags),
    );
    localStorage.setItem(
      `hypercal.tagTracking.${tagAccount}`,
      JSON.stringify(result.tracking),
    );
    setEvents((es) =>
      es.map((e) => ({
        ...e,
        tags: [
          ...new Set(
            (e.tags || [])
              .map((name) =>
                name === oldName ? replacement?.name || null : name,
              )
              .filter((x): x is string => !!x),
          ),
        ],
      })),
    );
    if (live) calendarCache.invalidateEvents(accountId!);
    setRefresh((n) => n + 1);
    flash(
      result.pending
        ? "Tag saved. Google event metadata is syncing in the background."
        : "Tag saved.",
    );
  }
  async function trackTag(tagName: string | null) {
    if (live && !canWrite)
      throw new Error("Connect and sync before changing tracked tags.");
    const tracking = live
      ? await api<Record<string, string | null>>("/tag-tracking", {
          method: "PUT",
          body: JSON.stringify({ viewKey: tagViewKey, tagName }),
        })
      : { ...tagTracking, [tagViewKey]: tagName };
    setTagTracking(tracking);
    localStorage.setItem(
      `hypercal.tagTracking.${tagAccount}`,
      JSON.stringify(tracking),
    );
  }
  const active = views.find((v) => v.id === activeView);
  const continuous =
    (active?.continuousScroll ?? true) && ["month", "week"].includes(layout);
  const bufferedRange = continuousRange(date, layout);
  const selection = active ? active.calendarIds : visible;
  const from = continuous
    ? bufferedRange.from
    : layout === "year"
      ? startOfYear(date)
      : startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const to = continuous
    ? bufferedRange.to
    : layout === "year"
      ? addDays(endOfYear(date), 1)
      : layout === "month" && !desktop
        ? monthRange(date, true).to
        : addDays(endOfMonth(date), 8);
  const rangeKey = `${from.toISOString()}|${to.toISOString()}|${JSON.stringify([...selection].sort())}`;
  const displayFrom = continuous
    ? from
    : layout === "day"
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
      : layout === "week"
        ? startOfWeek(date, { weekStartsOn: 1 })
        : from;
  const displayTo = continuous
    ? to
    : layout === "day"
      ? addDays(displayFrom, 1)
      : layout === "week"
        ? addDays(displayFrom, 7)
        : layout === "year"
          ? startOfYear(addYears(date, 1))
          : monthRange(date, !desktop).to;
  const streamWindow = prefetchWindow(
    scrollFocus || (layout === "month" ? monthRange(date).from : date),
    layout,
  );
  const streamContext = `${accountId}|${activeView}|${JSON.stringify([...selection].sort())}`;
  const eventStream = useEventStream({
    enabled:
      continuous &&
      live &&
      verified &&
      online &&
      !!accountId &&
      dataAccount === accountId &&
      selection.length > 0,
    context: streamContext,
    refresh,
    window: streamWindow,
    load: (chunk, signal) =>
      api(
        `/events?${new URLSearchParams({ from: chunk.from.toISOString(), to: chunk.to.toISOString(), calendars: JSON.stringify(selection) })}`,
        { signal },
      ),
    onChunk: (batch, chunk) =>
      setEvents((old) =>
        mergeEventChunk(old, batch.events, chunk.from, chunk.to, selection),
      ),
    readCache: (chunk) => {
      const data = calendarCache.readRange(
        accountId!,
        `stream:${JSON.stringify([...selection].sort())}:${chunk.key}`,
      );
      return data ? { events: data.events, warnings: [] } : null;
    },
    writeCache: (batch, chunk) =>
      calendarCache.writeRange(
        session!.user!,
        `stream:${JSON.stringify([...selection].sort())}:${chunk.key}`,
        batch.events,
        batch.refreshedAt || new Date().toISOString(),
      ),
  });
  const filtered = useMemo(
    () =>
      filterEvents(
        events.filter(
          (e) =>
            selection.includes(e.calendarId) &&
            (continuous ||
              (eventDate(e.start) < displayTo &&
                eventDate(e.end) > displayFrom)),
        ),
        active,
        search,
      ),
    [
      events,
      active,
      search,
      selection,
      continuous,
      displayFrom.getTime(),
      displayTo.getTime(),
    ],
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
  const backAction = useRef<() => void>(() => {});
  backAction.current = () => {
    if (recurrenceRequest) {
      recurrenceRequest.resolve(null);
      setRecurrenceRequest(null);
    }
    if (panel || preview || expandedDay || sharedRoute || layout !== "month") {
      setPanel(null);
      setPreview(null);
      setExpandedDay(null);
      setSidebar(false);
      setSharedRoute(null);
      clearSharedRoute();
      setLayout("month");
      setActiveView(getDefaultView(views, "month")?.id || null);
    } else if (sidebar) setSidebar(false);
    else NativeApp.exitApp();
  };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // One native listener reads current state, avoiding async remove/add races.
    const listener = NativeApp.addListener("backButton", () =>
      backAction.current(),
    );
    return () => {
      listener.then((handle) => handle.remove());
    };
  }, []);
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
        setCalendars(stored("hypercal.demo.calendars", demoCalendars));
        setViews(stored("hypercal.demo.views", initialViews));
        setVisible(
          stored<Calendar[]>("hypercal.demo.calendars", demoCalendars).map(
            (c) => c.id,
          ),
        );
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
  async function manualSync() {
    try {
      if (live && navigator.onLine)
        await api("/cache/refresh", { method: "POST" });
      await requestSync();
    } catch (error) {
      setError((error as Error).message);
    }
  }
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
      setSharedViews([]);
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
    Promise.all([
      api<Calendar[]>("/calendars"),
      api<SavedView[]>("/views"),
      api<SharedView[]>("/shared-views"),
    ])
      .then(([c, v, shared]) => {
        setSharedViews(shared);
        if (cancelled) return;
        setCalendars((old) => reuseRecords(old, c));
        setVisible((ids) => {
          const remaining = ids.filter((id) => c.some((x) => x.id === id));
          const added = c
            .filter((x) => !calendars.some((old) => old.id === x.id))
            .map((x) => x.id);
          return [...new Set([...remaining, ...added])];
        });
        setViews((old) => reuseRecords(old, v));
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
    if (continuous) {
      setBusy(false);
      return;
    }
    const seq = ++generation.current;
    const saved = calendarCache.readRange(accountId, rangeKey);
    if (saved) {
      setEvents(saved.events);

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
    continuous,
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
    else if (!live && verified)
      localStorage.setItem("hypercal.demo.views", JSON.stringify(views));
  }, [views, calendars, live, verified, accountId, dataAccount]);
  useEffect(() => {
    if (!live && verified)
      localStorage.setItem("hypercal.demo.events", JSON.stringify(events));
  }, [events, live, verified]);
  const move = useCallback(
    (step: number) => {
      setPreview(null);
      setExpandedDay(null);
      setDate((d) => shiftPeriod(d, layout, step));
    },
    [layout],
  );
  usePeriodGesture(
    surfaceRef,
    !continuous && !desktop && !sidebar && !panel && !preview && !expandedDay,
    move,
    setPeriodPreview,
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
      if (sharedRoute) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPanel((p) => (p === "palette" ? null : "palette"));
        return;
      }
      if (
        !Capacitor.isNativePlatform() &&
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "f" &&
        (!panel || panel === "find" || panel === "palette")
      ) {
        e.preventDefault();
        setPreview(null);
        setExpandedDay(null);
        setPanel("find");
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
      else if (key === "/") setPanel("find");
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
    const scope = await requestScope(editingEvent, "edit");
    if (!scope) return;
    const missing = cleanTags(draft.tags).filter(
      (name) => !tags.some((t) => t.name === name),
    );
    if (missing.length)
      await saveTags([
        ...tags,
        ...missing.map((name) => ({ name, color: "#4b99d2" })),
      ]);
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
      scope,
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
    const scope = await requestScope(e, "delete");
    if (!scope) return;
    if (live && !canWrite)
      throw new Error("Connect and finish syncing before deleting events.");
    if (live)
      await api(`/events/${encodeURIComponent(e.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ calendarId: e.calendarId, etag: e.etag, scope }),
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
            color: source.color,
            tags: source.tags,
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
        editingView?.id ? `/views/${v.id}` : "/views",
        { method: editingView?.id ? "PATCH" : "POST", body: JSON.stringify(v) },
      );
      setViews((vs) => {
        const next = editingView?.id
          ? vs.map((x) => (x.id === v.id ? saved : x))
          : [...vs, saved];
        return saved.isDefault
          ? assignLayoutDefault(next, saved.layout, saved.id)
          : next;
      });
      chooseView(saved);
    } else {
      const saved = { ...v, id: editingView?.id ? v.id : crypto.randomUUID() };
      setViews((vs) => {
        const next = editingView?.id
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
  const openEdit = (event: CalendarEvent) => {
    if (event.readOnly || (live && !canWrite)) return;
    setEditingEvent(event);
    setPreview(null);
    setExpandedDay(null);
    setPanel("event");
  };
  const commands = [
    {
      name: "Filter visible events",
      key: "Ctrl F",
      action: () => setPanel("find"),
    },
    ...(search
      ? [
          {
            name: "Clear event filter",
            key: "",
            action: () => {
              setSearch("");
              close();
            },
          },
        ]
      : []),
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
  if (sharedRoute)
    return (
      <SharedSpace
        key={`${sharedRoute.kind}:${sharedRoute.id || ""}`}
        route={sharedRoute}
        connected={live}
        calendars={calendars}
        draft={{
          name: active?.name || labels[layout],
          layout,
          include: active?.include || "",
          exclude: active?.exclude || "",
          hideAllDay: active?.hideAllDay || false,
          continuousScroll: active?.continuousScroll ?? true,
        }}
        onConnect={connectGoogle}
        onClose={() => {
          clearSharedRoute();
          setSharedRoute(null);
          setLayout("month");
          setActiveView(getDefaultView(views, "month")?.id || null);
          setMetadataRefresh((n) => n + 1);
        }}
      />
    );
  return (
    <div
      className={`app-shell ${desktop && desktopCollapsed ? "desktop-collapsed" : ""} ${Capacitor.isNativePlatform() ? "native" : ""}`}
    >
      <aside
        ref={drawerRef}
        style={!desktop ? { width: drawer.width } : undefined}
        className={`sidebar ${sidebar ? "open" : ""} ${drawer.dragging ? "dragging" : ""}`}
        inert={desktop ? desktopCollapsed : !sidebar}
      >
        <a className="brand" href="/" aria-label="HyperCal home">
          <span className="brand-symbol">H</span>
          <span>
            HyperCal<span className="brand-period">.</span>
          </span>
          <small>PREVIEW</small>
        </a>
        <button
          className="drawer-close icon-button"
          aria-label="Close navigation drawer"
          onClick={() => setSidebar(false)}
        >
          <X size={22} />
        </button>
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
            <span>VIEWS</span>
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
          {layouts.map((l) => {
            const replacement = getDefaultView(views, l);
            const Icon = layoutIcons[l];
            const selected =
              layout === l && activeView === (replacement?.id || null);
            return (
              <div className={`view-item ${selected ? "active" : ""}`} key={l}>
                <button
                  className="view-link"
                  onClick={() => {
                    if (replacement) chooseView(replacement);
                    else {
                      changeLayout(l);
                      setSidebar(false);
                    }
                  }}
                >
                  <Icon size={18} />
                  <span>{replacement?.name || labels[l]}</span>
                  {replacement && (
                    <small className="view-layout-label">{labels[l]}</small>
                  )}
                </button>
                <button
                  className="view-edit web-only"
                  aria-label={`Customize ${labels[l]} view`}
                  onClick={() => {
                    setEditingView(
                      replacement || {
                        id: "",
                        name: labels[l],
                        layout: l,
                        calendarIds: calendars.map((c) => c.id),
                        include: "",
                        exclude: "",
                        hideAllDay: false,
                        isDefault: true,
                      },
                    );
                    setPanel("view");
                  }}
                >
                  <Pencil size={13} />
                </button>
              </div>
            );
          })}
          {views
            .filter((v) => !v.isDefault)
            .map((v) => (
              <div
                className={`view-item ${activeView === v.id ? "active" : ""}`}
                key={v.id}
              >
                <button className="view-link" onClick={() => chooseView(v)}>
                  <SlidersHorizontal size={16} />
                  <span>{v.name}</span>
                  <kbd>{views.indexOf(v) < 9 ? views.indexOf(v) + 1 : ""}</kbd>
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
          {sharedViews.map((v) => (
            <button
              key={v.id}
              className="view-link"
              onClick={() => {
                setSharedRoute({ kind: "view", id: v.id });
                setSidebar(false);
              }}
            >
              <Users size={17} />
              <span>{v.name}</span>
              <small className="view-layout-label">Shared</small>
            </button>
          ))}
          <button
            className="view-link"
            onClick={() => {
              setSharedRoute({ kind: "hub" });
              setSidebar(false);
            }}
          >
            <Users size={17} />
            <span>Shared views</span>
          </button>
        </nav>
        <section className="calendar-list">
          <div className="section-label">
            <button
              className="section-toggle"
              aria-expanded={!calendarsCollapsed}
              aria-controls="sidebar-calendars"
              onClick={() => {
                setCalendarsCollapsed(!calendarsCollapsed);
                localStorage.setItem(
                  "hypercal.calendarsCollapsed",
                  JSON.stringify(!calendarsCollapsed),
                );
              }}
            >
              <ChevronDown
                size={15}
                style={{
                  transform: calendarsCollapsed ? "rotate(-90deg)" : undefined,
                }}
              />
              <span>CALENDARS</span>
            </button>
            <button
              className="icon-button"
              aria-label="Add calendar"
              onClick={() => setPanel("subscription")}
            >
              <Plus size={16} />
            </button>
          </div>
          <div id="sidebar-calendars" hidden={calendarsCollapsed}>
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
          </div>
        </section>
        <TagsSection
          tags={tags}
          live={live}
          canWrite={canWrite}
          onChange={saveTags}
          trackedTag={trackedTag}
          onTrack={trackTag}
          onEdit={(name, tag) => changeTag(name, tag)}
          onDelete={(name) => changeTag(name, null)}
        />
        <div className="sidebar-bottom">
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
            className="icon-button desktop-menu"
            aria-label={
              desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onClick={() =>
              setDesktopCollapsed((value) => {
                localStorage.setItem(
                  "hypercal.sidebarCollapsed",
                  JSON.stringify(!value),
                );
                return !value;
              })
            }
          >
            <Menu size={21} />
          </button>
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
          <TagCountdowns
            tags={tags}
            events={events}
            live={live}
            canRead={verified && online}
            accountKey={tagAccount}
            refresh={refresh}
            trackedTag={trackedTag}
            viewKey={tagViewKey}
          />
          {search && (
            <button
              className="active-event-filter"
              title={`Clear filter: ${search}`}
              aria-label={`Clear event filter: ${search}`}
              onClick={() => setSearch("")}
            >
              <Search size={13} />
              <span>{search}</span>
              <X size={13} />
            </button>
          )}
          <div className="mobile-header-actions">
            <SyncIndicator
              busy={busy || (continuous && eventStream.busy)}
              cached={usingCache}
              online={online}
              onRefresh={manualSync}
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
              aria-label="Search events"
              title="Search events (Ctrl K)"
              onClick={() => setPanel("palette")}
            >
              <Search size={20} />
            </button>
            <SyncIndicator
              busy={busy || (continuous && eventStream.busy)}
              cached={usingCache}
              online={online}
              onRefresh={manualSync}
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
            <button
              className={`avatar ${live ? "connected" : ""}`}
              aria-label="Account and settings"
              onClick={() => setPanel("settings")}
            >
              {live ? session?.user?.email[0].toUpperCase() : "H"}
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
        {continuous && eventStream.error && (
          <div className="warning-banner" role="status">
            Some events could not load. Scrolling is still available.{" "}
            {eventStream.error}
            <button onClick={() => setRefresh((n) => n + 1)}>Retry</button>
          </div>
        )}
        {(continuous ? eventStream.warnings : warnings).length > 0 && (
          <div className="warning-banner" role="status">
            <AlertCircle size={15} />
            {(continuous ? eventStream.warnings : warnings).join(" ")}
          </div>
        )}
        <div
          ref={surfaceRef}
          className="calendar-surface"
          aria-busy={busy || (continuous && eventStream.busy)}
        >
          <div className="period-track">
            {periodPreview &&
              [-1, 1].map((step) => (
                <div
                  key={step}
                  inert
                  aria-hidden="true"
                  className={`period-page period-adjacent ${step < 0 ? "period-before" : "period-after"}`}
                >
                  <CalendarCanvas
                    layout={layout}
                    date={shiftPeriod(date, layout, step)}
                    events={filtered}
                    calendars={calendars}
                    onEvent={() => {}}
                    onExpandDay={() => {}}
                    onCreate={() => {}}
                    onDate={() => {}}
                  />
                </div>
              ))}
            <div className="period-page period-current">
              <CalendarViewport
                key={`${activeView || "builtin"}:${layout}`}
                continuous={continuous}
                onApproach={approachDate}
                onViewportDate={(next) => {
                  setPreview(null);
                  setExpandedDay(null);
                  setDate(next);
                }}
                layout={layout}
                date={date}
                events={filtered}
                calendars={calendars}
                onEvent={(e, anchor) => setPreview({ event: e, anchor })}
                onEdit={
                  desktop && !Capacitor.isNativePlatform()
                    ? openEdit
                    : undefined
                }
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
            </div>
          </div>
          {!busy &&
            !(continuous && eventStream.busy) &&
            filtered.length === 0 && (
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
      </main>
      {expandedDay && (
        <DayOverflowPopover
          date={expandedDay.date}
          loading={dayLoading}
          error={dayError}
          anchor={expandedDay.anchor}
          events={dayEvents || events.filter((e) => onDay(e, expandedDay.date))}
          calendars={calendars}
          onClose={closeExpanded}
          onEvent={(event, anchor) => setPreview({ event, anchor })}
          onEdit={
            desktop && !Capacitor.isNativePlatform() ? openEdit : undefined
          }
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
          onEdit={() => openEdit(preview.event)}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {recurrenceRequest && (
        <RecurrenceDialog
          action={recurrenceRequest.action}
          onChoose={(scope) => {
            recurrenceRequest.resolve(scope);
            setRecurrenceRequest(null);
          }}
        />
      )}
      {panel === "event" && (
        <Panel
          variant={editingEvent ? "event" : "quick-event"}
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
            tags={tags}
            date={newDate}
            calendars={calendars}
            live={live}
            offline={live && !canWrite}
            email={session?.user?.email}
            notificationDefault={notificationDefault}
            onClose={close}
            onSave={saveEvent}
            onDelete={deleteEvent}
          />
        </Panel>
      )}
      {panel === "view" && canEditViews && (
        <Panel
          title={
            editingView?.id
              ? "Edit view"
              : editingView?.isDefault
                ? `Customize ${labels[editingView.layout]} view`
                : "Create a custom view"
          }
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
        <Panel title="Add calendar" onClose={close}>
          <SubscriptionEditor
            live={live}
            calendars={calendars}
            onConnect={() => setPanel("settings")}
            onDemoCalendar={(c) => {
              localStorage.setItem(
                "hypercal.demo.calendars",
                JSON.stringify([...calendars, c]),
              );
              setCalendars((cs) => [...cs, c]);
              setVisible((ids) => [...ids, c.id]);
              setActiveView(null);
              close();
            }}
            onAdded={(c) => {
              setCalendars((cs) => [...cs, c]);
              setVisible((ids) => [...ids, c.id]);
              setActiveView(null);
              close();
              flash(
                c.source === "google"
                  ? "Calendar created in Google Calendar."
                  : "Calendar added.",
              );
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
                <button className="secondary-button" onClick={connectGoogle}>
                  Reconnect Google / allow calendar creation
                </button>
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
          <NotificationDefaults
            value={notificationDefault}
            disabled={live && !canWrite}
            onSave={async (value) => {
              if (live) {
                await api("/preferences", {
                  method: "PATCH",
                  body: JSON.stringify({ notificationDefault: value }),
                });
                setSession((s) =>
                  s ? { ...s, notificationDefault: value } : s,
                );
              }
              localStorage.setItem(
                `hypercal.notificationDefault.${session?.user?.id || "demo"}`,
                JSON.stringify(value),
              );
              setNotificationDefault(value);
              flash("Default notification saved.");
            }}
          />
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
          <h3>Shared views</h3>
          <p>
            Invite friends with Google sign-in. Each member chooses calendars to
            contribute. Open Shared views in the sidebar to create invitations
            and read-only export links.
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
      {panel === "find" && (
        <Panel title="Filter visible events" onClose={close} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              close();
            }}
          >
            <label className="field">
              Search titles, locations and descriptions
              <input
                autoFocus
                aria-label="Filter visible events"
                placeholder="Find in this view…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <p className="small muted" role="status">
              {filtered.length} matching events in this view
            </p>
            <div className="filter-actions">
              <button type="submit" className="primary-button">
                Show results
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSearch("")}
              >
                Clear filter
              </button>
            </div>
          </form>
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
            continuousScroll:
              ["month", "week"].includes(viewLayout) &&
              f.get("continuousScroll") === "on",
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
        {["month", "week"].includes(viewLayout) && (
          <label className="checkbox-field continuous-option">
            <input
              type="checkbox"
              name="continuousScroll"
              defaultChecked={view?.continuousScroll ?? true}
            />
            <span>
              Continuous scrolling{" "}
              <small>
                {viewLayout === "month"
                  ? "Scroll vertically and snap to the nearest week row."
                  : "Scroll horizontally through individual days, without returning to Monday."}
              </small>
            </span>
          </label>
        )}
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
        {view?.id && (
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
        Private to you. Share a view from the sidebar.
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
  onDemoCalendar,
}: {
  live: boolean;
  calendars: Calendar[];
  onConnect: () => void;
  onAdded: (c: Calendar) => void;
  onRemove: (id: string) => Promise<void>;
  onDemoCalendar: (c: Calendar) => void;
}) {
  const [mode, setMode] = useState<"new" | "subscription" | "import">("new");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <div
        className="calendar-add-modes"
        role="group"
        aria-label="Calendar source"
      >
        {(
          [
            ["new", "New calendar"],
            ["subscription", "Subscribe"],
            ["import", "Import file"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className="secondary-button"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="panel-description">
        {mode === "new"
          ? "Create an empty calendar in your Google account. No subscription link needed."
          : mode === "subscription"
            ? "Follow a public iCalendar feed. Subscriptions are read-only."
            : "Import a read-only snapshot from an iCalendar file."}
      </p>
      {!live && mode !== "new" ? (
        <button className="primary-button" onClick={onConnect}>
          Connect Google
        </button>
      ) : (
        <form
          className="editor-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              if (!live) {
                onDemoCalendar({
                  id: crypto.randomUUID(),
                  name: String(f.get("name")).trim(),
                  color: "#4b99d2",
                  readOnly: false,
                  source: "demo",
                });
                return;
              }
              if (mode === "import" && (!file || file.size > 4 * 1024 * 1024))
                throw new Error("Choose an .ics file smaller than 4 MB.");
              const body =
                mode === "import"
                  ? {
                      name: f.get("name"),
                      color: f.get("color"),
                      text: await file!.text(),
                    }
                  : Object.fromEntries(f);
              const c = await api<Calendar>(
                mode === "new"
                  ? "/calendars"
                  : mode === "import"
                    ? "/imports"
                    : "/subscriptions",
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
                name="name"
                autoFocus
                required
                placeholder="Projects"
                maxLength={80}
              />
            </label>
            {mode === "subscription" && (
              <label className="field">
                Subscription URL
                <input
                  name="url"
                  required
                  placeholder="https://example.com/calendar.ics"
                  maxLength={4000}
                />
              </label>
            )}
            {mode === "import" && (
              <label className="field">
                iCalendar file
                <input
                  type="file"
                  required
                  accept=".ics,text/calendar"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            )}
            {mode !== "new" && (
              <label className="field">
                Calendar color
                <input type="color" name="color" defaultValue="#55b080" />
              </label>
            )}
          </fieldset>
          {!live && (
            <p className="inline-note">
              Demo calendar, saved on this device. Connect Google to create a
              live calendar.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
              {error.includes("Reconnect") && (
                <button
                  type="button"
                  className="subtle-link"
                  onClick={onConnect}
                >
                  Open account settings
                </button>
              )}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy
              ? "Saving…"
              : mode === "new"
                ? "Create calendar"
                : mode === "import"
                  ? "Import calendar"
                  : "Subscribe"}
          </button>
        </form>
      )}
      {calendars.some((c) => c.source === "ical") && (
        <section className="subscription-list">
          <h3>Subscriptions and imports</h3>
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
                    setError("");
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
