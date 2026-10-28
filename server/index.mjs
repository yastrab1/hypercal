import "dotenv/config";
import express from "express";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  dataDir,
  getAccount,
  upsertAccount,
  addItem,
  updateItem,
  removeItem,
  saveViewDefinition,
  setLayoutDefault,
} from "./store.mjs";
import { fetchCalendar, parseFeed } from "./feeds.mjs";
import { copiedEventBody } from "./copy-event.mjs";
import {
  configured,
  oauth,
  scopes,
  googleRequest,
  allPages,
  normalizeEvent,
} from "./google.mjs";
const nativeAttempts = new Map();
setInterval(() => {
  for (const [id, a] of nativeAttempts)
    if (Date.now() > a.expires) nativeAttempts.delete(id);
}, 60000).unref();
const app = express();
const FileStore = FileStoreFactory(session);
const appUrl = process.env.APP_URL || "http://localhost:5173";
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity:
      process.env.COOKIE_SECURE === "true" ? undefined : false,
  }),
);
app.use("/api/imports", express.json({ limit: "5mb" }));
app.use(express.json({ limit: "256kb" }));
const secretPath = resolve(dataDir, "session-secret");
let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (existsSync(secretPath)) secret = readFileSync(secretPath, "utf8");
  else {
    secret = randomBytes(48).toString("hex");
    writeFileSync(secretPath, secret, { mode: 0o600 });
  }
}
app.use(
  session({
    secret,
    store: new FileStore({
      path: resolve(dataDir, "sessions"),
      logFn: () => {},
    }),
    resave: false,
    saveUninitialized: false,
    name: "hypercal.sid",
    cookie: {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
      maxAge: 30 * 86400000,
    },
  }),
);
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!req.session.csrf) req.session.csrf = randomBytes(24).toString("hex");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== new URL(appUrl).origin)
      return res.status(403).json({ error: "Request origin is not allowed." });
    const token = req.headers["x-csrf-token"];
    const expected = req.session.csrf;
    if (
      typeof token !== "string" ||
      Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    )
      return res
        .status(403)
        .json({ error: "Session expired. Refresh the page and try again." });
  }
  next();
});
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/session", (req, res) => {
  const a = getAccount(req.session.accountId);
  res.json({
    connected: !!a,
    configured,
    user: a ? { id: req.session.accountId, email: a.email } : null,
    csrf: req.session.csrf,
    appUrl,
  });
});
app.post("/api/native-auth/start", (req, res) => {
  if (!configured)
    return res
      .status(400)
      .json({ error: "Google OAuth client is not configured." });
  if (req.session.nativeAttempt)
    nativeAttempts.delete(req.session.nativeAttempt);
  const id = randomBytes(32).toString("hex");
  nativeAttempts.set(id, { expires: Date.now() + 5 * 60000, launched: false });
  req.session.nativeAttempt = id;
  res.json({ url: `${appUrl}/auth/google?native=${id}` });
});
app.post("/api/native-auth/claim", async (req, res) => {
  const id = req.session.nativeAttempt;
  const attempt = nativeAttempts.get(id);
  if (!attempt || Date.now() > attempt.expires)
    return res
      .status(400)
      .json({ error: "Sign-in expired. Please try again." });
  if (!attempt.accountId) return res.json({ connected: false });
  nativeAttempts.delete(id);
  await new Promise((done, fail) =>
    req.session.regenerate((e) => (e ? fail(e) : done())),
  );
  req.session.accountId = attempt.accountId;
  res.json({ connected: true });
});
app.get("/auth/google", async (req, res) => {
  if (!configured) return res.redirect("/?authError=not_configured");
  let nativeId;
  if (req.query.native) {
    nativeId = String(req.query.native);
    const a = nativeAttempts.get(nativeId);
    if (!a || a.launched || Date.now() > a.expires)
      return res
        .status(400)
        .send("Sign-in link expired. Start again in the HyperCal Android app.");
    a.launched = true;
  }
  const client = oauth();
  const { codeVerifier, codeChallenge } =
    await client.generateCodeVerifierAsync();
  req.session.oauth = {
    state: randomBytes(32).toString("hex"),
    verifier: codeVerifier,
    created: Date.now(),
    nativeId,
  };
  const url = client.generateAuthUrl({
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state: req.session.oauth.state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  req.session.save((e) =>
    e ? res.status(500).send("Unable to start sign-in.") : res.redirect(url),
  );
});
app.get("/auth/google/callback", async (req, res) => {
  const pending = req.session.oauth;
  delete req.session.oauth;
  if (req.query.error) return res.redirect("/?authError=cancelled");
  if (
    !pending ||
    pending.state !== req.query.state ||
    Date.now() - pending.created > 600000 ||
    typeof req.query.code !== "string"
  )
    return res
      .status(400)
      .send("Sign-in expired or invalid. Please retry from HyperCal.");
  try {
    const client = oauth();
    const { tokens } = await client.getToken({
      code: req.query.code,
      codeVerifier: pending.verifier,
    });
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: client._clientId,
    });
    const user = ticket.getPayload();
    const old = getAccount(user.sub);
    upsertAccount(user.sub, {
      email: user.email,
      tokens: { ...old?.tokens, ...tokens },
    });
    if (pending.nativeId) {
      const attempt = nativeAttempts.get(pending.nativeId);
      if (!attempt || Date.now() > attempt.expires)
        return res.status(400).send("Android sign-in expired. Please retry.");
      attempt.accountId = user.sub;
      return res
        .type("html")
        .send(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HyperCal connected</title><body><h1>Google Calendar connected</h1><p>Return to the HyperCal Android app to continue.</p></body></html>',
        );
    }
    await new Promise((done, fail) =>
      req.session.regenerate((e) => (e ? fail(e) : done())),
    );
    req.session.accountId = user.sub;
    req.session.save((e) =>
      e ? res.status(500).send("Unable to save sign-in.") : res.redirect("/"),
    );
  } catch (e) {
    console.error("Google sign-in failed:", e.code || "oauth_error");
    res.redirect("/?authError=failed");
  }
});
function auth(req, res, next) {
  if (!getAccount(req.session.accountId))
    return res
      .status(401)
      .json({ error: "Connect Google to use live calendars." });
  next();
}
app.post("/api/logout", (req, res) =>
  req.session.destroy(() => {
    res.clearCookie("hypercal.sid");
    res.json({ ok: true });
  }),
);
app.get("/api/calendars", auth, async (req, res) => {
  const items = await allPages(
    req.session.accountId,
    "users/me/calendarList?maxResults=250",
  );
  res.json(
    items
      .filter((x) => x.accessRole !== "freeBusyReader")
      .map((c) => ({
        id: c.id,
        name: c.summaryOverride || c.summary,
        color: c.backgroundColor || "#5750d9",
        readOnly: !["owner", "writer"].includes(c.accessRole),
        primary: !!c.primary,
        source: "google",
      }))
      .concat(
        getAccount(req.session.accountId).subscriptions.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          readOnly: true,
          source: "ical",
        })),
      ),
  );
});
const rangeSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    calendars: z.string().max(10000),
  })
  .refine(
    (x) =>
      new Date(x.to) > new Date(x.from) &&
      new Date(x.to) - new Date(x.from) <= 370 * 86400000,
    { message: "Choose a range of at most 370 days." },
  );
app.get("/api/events", auth, async (req, res) => {
  const { from, to, calendars } = rangeSchema.parse(req.query);
  const id = req.session.accountId;
  const selected = JSON.parse(calendars);
  if (
    !Array.isArray(selected) ||
    selected.length > 40 ||
    selected.some((x) => typeof x !== "string")
  )
    return res.status(400).json({ error: "Select at most 40 calendars." });
  const available = await allPages(id, "users/me/calendarList?maxResults=250");
  const account = getAccount(id);
  const events = [],
    warnings = [];
  const results = await Promise.allSettled(
    selected.map(async (calendarId) => {
      const sub = account.subscriptions.find((s) => s.id === calendarId);
      if (sub) {
        let text = sub.cached;
        try {
          if (
            sub.kind !== "import" &&
            (!text || Date.now() - (sub.refreshedAt || 0) > 5 * 60000)
          ) {
            text = await fetchCalendar(sub.url);
            updateItem(id, "subscriptions", sub.id, {
              cached: text,
              refreshedAt: Date.now(),
            });
          }
        } catch {
          warnings.push(
            `${sub.name}: feed refresh failed${text ? ", showing last saved copy" : ""}.`,
          );
        }
        return text ? parseFeed(text, sub, from, to) : [];
      }
      const c = available.find((c) => c.id === calendarId);
      if (!c) return [];
      const items = await allPages(
        id,
        `calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`,
      );
      return items
        .filter((e) => e.status !== "cancelled" && e.start && e.end)
        .map((e) => normalizeEvent(e, c));
    }),
  );
  results.forEach((r, i) =>
    r.status === "fulfilled"
      ? events.push(...r.value)
      : warnings.push(
          `Could not load ${available.find((c) => c.id === selected[i])?.summary || "calendar"}. Try refreshing.`,
        ),
  );
  if (results.length && results.every((r) => r.status === "rejected"))
    throw Object.assign(
      new Error("Unable to load calendars. Reconnect Google or try again."),
      { status: 502 },
    );
  res.json({ events, warnings, refreshedAt: new Date().toISOString() });
});
const eventSchema = z
  .object({
    calendarId: z.string().min(1).max(1024),
    title: z.string().trim().min(1).max(1024),
    description: z.string().max(8000).default(""),
    location: z.string().max(1024).default(""),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    etag: z.string().optional(),
    recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
    timeZone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone.")
      .optional(),
    useDefaultReminders: z.boolean().optional(),
    reminderMinutes: z.number().int().min(0).max(40320).nullable().optional(),
  })
  .refine(
    (e) =>
      e.allDay
        ? /^\d{4}-\d{2}-\d{2}$/.test(e.start) &&
          /^\d{4}-\d{2}-\d{2}$/.test(e.end)
        : z.iso.datetime({ offset: true }).safeParse(e.start).success &&
          z.iso.datetime({ offset: true }).safeParse(e.end).success,
    { message: "Choose valid start and end dates." },
  )
  .refine((e) => new Date(e.end) > new Date(e.start), {
    message: "End must be after start.",
  });
function eventBody(e) {
  const time = e.allDay
    ? { start: { date: e.start }, end: { date: e.end } }
    : {
        start: {
          dateTime: e.start,
          timeZone:
            e.timeZone || process.env.CALENDAR_TIMEZONE || "Europe/Prague",
        },
        end: {
          dateTime: e.end,
          timeZone:
            e.timeZone || process.env.CALENDAR_TIMEZONE || "Europe/Prague",
        },
      };
  return {
    summary: e.title,
    description: e.description,
    location: e.location,
    ...time,
    ...(e.useDefaultReminders
      ? { reminders: { useDefault: true } }
      : e.reminderMinutes !== undefined
        ? {
            reminders: {
              useDefault: false,
              overrides:
                e.reminderMinutes === null
                  ? []
                  : [{ method: "popup", minutes: e.reminderMinutes }],
            },
          }
        : {}),
    ...(e.recurrence && e.recurrence !== "none"
      ? { recurrence: [`RRULE:FREQ=${e.recurrence.toUpperCase()}`] }
      : {}),
  };
}
app.post("/api/events", auth, async (req, res) => {
  const e = eventSchema.parse(req.body);
  const result = await googleRequest(
    req.session.accountId,
    `calendars/${encodeURIComponent(e.calendarId)}/events`,
    { method: "POST", body: eventBody(e) },
  );
  res.status(201).json(result);
});
app.post("/api/events/:id/copy", auth, async (req, res) => {
  const { calendarId, destinationCalendarId, etag } = z
    .object({
      calendarId: z.string().min(1).max(1024),
      destinationCalendarId: z.string().min(1).max(1024),
      etag: z.string().optional(),
    })
    .parse(req.body);
  if (calendarId === destinationCalendarId)
    return res
      .status(400)
      .json({ error: "Choose a different destination calendar." });
  const calendars = await allPages(
    req.session.accountId,
    "users/me/calendarList?maxResults=250",
  );
  const destination = calendars.find((c) => c.id === destinationCalendarId);
  if (!destination || !["owner", "writer"].includes(destination.accessRole))
    return res
      .status(403)
      .json({ error: "Choose a calendar you can write to." });
  const source = await googleRequest(
    req.session.accountId,
    `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(req.params.id)}`,
  );
  if (etag && source.etag !== etag)
    return res
      .status(412)
      .json({
        error:
          "This event changed in Google Calendar. Refresh before copying again.",
      });
  const copied = await googleRequest(
    req.session.accountId,
    `calendars/${encodeURIComponent(destinationCalendarId)}/events`,
    { method: "POST", body: copiedEventBody(source) },
  );
  res.status(201).json(normalizeEvent(copied, destination));
});
app.patch("/api/events/:id", auth, async (req, res) => {
  const e = eventSchema.parse(req.body);
  if (!e.etag)
    return res.status(400).json({ error: "Refresh the event before editing." });
  const result = await googleRequest(
    req.session.accountId,
    `calendars/${encodeURIComponent(e.calendarId)}/events/${encodeURIComponent(req.params.id)}`,
    { method: "PATCH", body: eventBody(e), etag: e.etag },
  );
  res.json(result);
});
app.delete("/api/events/:id", auth, async (req, res) => {
  const { calendarId, etag } = z
    .object({ calendarId: z.string(), etag: z.string() })
    .parse(req.body);
  await googleRequest(
    req.session.accountId,
    `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(req.params.id)}`,
    { method: "DELETE", etag },
  );
  res.json({ ok: true });
});
const viewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  layout: z.enum(["day", "week", "month", "year"]),
  calendarIds: z.array(z.string()).max(40),
  include: z.string().max(200).default(""),
  exclude: z.string().max(200).default(""),
  hideAllDay: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});
app.get("/api/views", auth, (req, res) =>
  res.json(getAccount(req.session.accountId).views),
);
app.post("/api/views", auth, (req, res) =>
  res.status(201).json(
    saveViewDefinition(req.session.accountId, {
      ...viewSchema.parse(req.body),
      schemaVersion: 1,
      ownerId: req.session.accountId,
      visibility: "private",
    }),
  ),
);
app.patch("/api/views/:id", auth, (req, res) => {
  const v = saveViewDefinition(
    req.session.accountId,
    viewSchema.parse(req.body),
    req.params.id,
  );
  if (!v) return res.status(404).json({ error: "View not found." });
  res.json(v);
});
app.delete("/api/views/:id", auth, (req, res) => {
  removeItem(req.session.accountId, "views", req.params.id);
  res.json({ ok: true });
});
app.patch("/api/view-defaults/:layout", auth, (req, res) => {
  const layout = z
    .enum(["day", "week", "month", "year"])
    .parse(req.params.layout);
  const { viewId } = z
    .object({ viewId: z.string().nullable() })
    .parse(req.body);
  const views = setLayoutDefault(req.session.accountId, layout, viewId);
  if (!views)
    return res
      .status(400)
      .json({ error: "Choose a view belonging to this layout." });
  res.json(views);
});
app.post("/api/subscriptions", auth, async (req, res) => {
  const { name, url, color } = z
    .object({
      name: z.string().trim().min(1).max(80),
      url: z.string().max(4000),
      color: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#08916d"),
    })
    .parse(req.body);
  if (getAccount(req.session.accountId).subscriptions.length >= 20)
    return res
      .status(400)
      .json({ error: "The prototype supports up to 20 subscriptions." });
  const text = await fetchCalendar(url);
  parseFeed(
    text,
    { id: "validate" },
    new Date().toISOString(),
    new Date(Date.now() + 86400000).toISOString(),
  );
  const s = addItem(req.session.accountId, "subscriptions", {
    name,
    url,
    color,
    cached: text,
    refreshedAt: Date.now(),
  });
  res
    .status(201)
    .json({ id: s.id, name, color, readOnly: true, source: "ical" });
});
app.post("/api/imports", auth, (req, res) => {
  const { name, text, color } = z
    .object({
      name: z.string().trim().min(1).max(80),
      text: z.string().max(4 * 1024 * 1024),
      color: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#0b8043"),
    })
    .parse(req.body);
  if (getAccount(req.session.accountId).subscriptions.length >= 20)
    return res.status(400).json({
      error:
        "The prototype supports up to 20 imported calendars and subscriptions.",
    });
  if (!text.includes("BEGIN:VCALENDAR"))
    return res
      .status(400)
      .json({ error: "Choose a valid .ics calendar file." });
  parseFeed(
    text,
    { id: "validate" },
    new Date().toISOString(),
    new Date(Date.now() + 86400000).toISOString(),
  );
  const s = addItem(req.session.accountId, "subscriptions", {
    name,
    color,
    kind: "import",
    cached: text,
    refreshedAt: Date.now(),
  });
  res
    .status(201)
    .json({ id: s.id, name, color, readOnly: true, source: "ical" });
});
app.delete("/api/subscriptions/:id", auth, (req, res) => {
  removeItem(req.session.accountId, "subscriptions", req.params.id);
  res.json({ ok: true });
});
app.get("/downloads/hypercal-debug.apk", (req, res) => {
  res.download(
    resolve("dist/downloads/hypercal-debug.apk"),
    `HyperCal-${JSON.parse(readFileSync(resolve("package.json"), "utf8")).version}-debug.apk`,
    { headers: { "Cache-Control": "no-store" } },
  );
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/"))
    return res.status(404).json({ error: "Route not found." });
  res.sendFile(resolve("dist/index.html"));
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: err.issues[0]?.message || "Invalid input." });
  const status = err.status || err.response?.status || 400;
  const message =
    status === 412
      ? "This event changed in Google Calendar. Refresh before editing again."
      : status === 401
        ? "Google sign-in expired. Reconnect your account."
        : status === 403
          ? "Google denied access. Check Calendar API access and permissions."
          : status >= 500
            ? "The calendar service is unavailable. Please try again."
            : err.message || "Request failed.";
  console.error(req.method, req.path, status);
  res
    .status(status >= 400 && status <= 599 ? status : 500)
    .json({ error: message });
});
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `HyperCal listening on ${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3001}; Google ${configured ? "configured" : "needs OAuth client"}`,
    ),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
export { app, server };
