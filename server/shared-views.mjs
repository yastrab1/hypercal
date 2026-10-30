import { z } from "zod";
import { resolve } from "node:path";
import { SharedStore, tokenHash } from "./shared-store.mjs";
import { dataDir, getAccount } from "./store.mjs";
import { allPages, normalizeEvent } from "./google.mjs";
import { filterEvents } from "../src/domain.mjs";
const definition = z.object({
  continuousScroll: z.boolean().default(true),
  name: z.string().trim().min(1).max(60),
  layout: z.enum(["day", "week", "month", "year"]),
  include: z.string().max(500).default(""),
  exclude: z.string().max(500).default(""),
  hideAllDay: z.boolean().default(false),
});
const contributions = z
  .array(
    z.object({
      calendarId: z.string().min(1).max(1024),
      detail: z.enum(["busy", "titles", "details"]),
      publicAllowed: z.boolean().default(false),
    }),
  )
  .max(10)
  .refine(
    (cs) => new Set(cs.map((c) => c.calendarId)).size === cs.length,
    "Select each calendar once.",
  );
const range = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine(
    (r) =>
      new Date(r.to) > new Date(r.from) &&
      new Date(r.to) - new Date(r.from) <= 370 * 86400000,
    "Choose a range of at most 370 days.",
  );
export function sharedInfo(v, user) {
  const owner = v.ownerId === user;
  return {
    id: v.id,
    name: v.name,
    layout: v.layout,
    include: v.include,
    exclude: v.exclude,
    hideAllDay: v.hideAllDay,
    continuousScroll: !!v.continuousScroll,
    isOwner: owner,
    members: Object.entries(v.members).map(([id, m]) => ({
      id,
      email: m.email,
      isYou: id === user,
      isOwner: id === v.ownerId,
      contributions: m.contributions,
    })),
    invitations: owner
      ? v.invitations
          .filter((i) => !i.usedAt && i.expiresAt > Date.now())
          .map(({ id, email, expiresAt }) => ({ id, email, expiresAt }))
      : [],
    links: owner
      ? v.links
          .filter((l) => l.expiresAt > Date.now())
          .map(({ id, scope, expiresAt }) => ({ id, scope, expiresAt }))
      : [],
  };
}
export function publicEvent(event, calendarId, id, policy) {
  return {
    id,
    calendarId,
    title: policy === "busy" ? "Busy" : event.title,
    description: policy === "details" ? event.description : "",
    location: policy === "details" ? event.location : "",
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    color: event.color,
    readOnly: true,
    source: "google",
  };
}
async function sourceEvents(accountId, calendarId, from, to) {
  const calendars = await allPages(
    accountId,
    "users/me/calendarList?maxResults=250",
    { cache: false },
  );
  const c = calendars.find((c) => c.id === calendarId);
  if (!c) throw new Error("Calendar is no longer available.");
  const params = new URLSearchParams({
    timeMin: from,
    timeMax: to,
    singleEvents: "true",
    maxResults: "2500",
    orderBy: "startTime",
  });
  const items = await allPages(
    accountId,
    `calendars/${encodeURIComponent(calendarId)}/events?${params}`,
  );
  const data = {
    calendar: c,
    events: items
      .filter((e) => e.status !== "cancelled" && e.start && e.end)
      .map((e) => normalizeEvent(e, c)),
  };
  return data;
}
export async function aggregateShared(
  v,
  from,
  to,
  isPublic = false,
  load = sourceEvents,
) {
  const calendars = [],
    events = [],
    warnings = [];
  const jobs = Object.entries(v.members).flatMap(([accountId, m]) =>
    m.contributions
      .filter((c) => !isPublic || c.publicAllowed)
      .map(async (contribution) => {
        const data = await load(accountId, contribution.calendarId, from, to);
        const policy =
          isPublic && contribution.detail === "details"
            ? "titles"
            : contribution.detail;
        const id =
          "shared-" +
          tokenHash(`${v.id}:${accountId}:${contribution.calendarId}`).slice(
            0,
            24,
          );
        calendars.push({
          id,
          name: isPublic
            ? "Shared calendar"
            : `${m.email} · ${data.calendar.summary || "Calendar"}`,
          color: data.calendar.backgroundColor || "#7986cb",
          readOnly: true,
          source: "google",
        });
        events.push(
          ...data.events.map((e) =>
            publicEvent(e, id, tokenHash(`${id}:${e.id}`).slice(0, 32), policy),
          ),
        );
      }),
  );
  const results = await Promise.allSettled(jobs);
  if (results.some((r) => r.status === "rejected"))
    warnings.push(
      "Some contributed calendars could not refresh. Their owners may need to reconnect.",
    );
  // Redact before filtering: hidden notes/titles must never influence the result.
  return {
    calendars,
    events: filterEvents(events, {
      ...v,
      calendarIds: calendars.map((c) => c.id),
    }),
    warnings,
  };
}
const esc = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
export function sharedICS(events, name) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HyperCal//Shared view//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(name)}`,
  ];
  for (const e of events) {
    const dt = (value) =>
      new Date(value)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@hypercal`,
      `DTSTAMP:${dt(new Date())}`,
      `SUMMARY:${esc(e.title)}`,
      e.allDay
        ? `DTSTART;VALUE=DATE:${e.start.replaceAll("-", "")}`
        : `DTSTART:${dt(e.start)}`,
      e.allDay
        ? `DTEND;VALUE=DATE:${e.end.replaceAll("-", "")}`
        : `DTEND:${dt(e.end)}`,
      ...(e.tags?.length ? [`CATEGORIES:${e.tags.map(esc).join(",")}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  // Fold by UTF-8 bytes, keeping multibyte characters intact.
  return (
    lines
      .flatMap((line) => {
        const parts = [];
        let out = "";
        for (const char of line) {
          if (Buffer.byteLength(out + char) > 74) {
            parts.push(out);
            out = " " + char;
          } else out += char;
        }
        parts.push(out);
        return parts;
      })
      .join("\r\n") + "\r\n"
  );
}
function ensureUnchanged(before, after) {
  if (
    JSON.stringify([
      before.members,
      before.include,
      before.exclude,
      before.hideAllDay,
    ]) !==
    JSON.stringify([
      after.members,
      after.include,
      after.exclude,
      after.hideAllDay,
    ])
  )
    throw Object.assign(
      new Error("Sharing changed during refresh. Please refresh again."),
      { status: 409, expose: true },
    );
}
export function registerSharedViews(app, auth, appUrl) {
  const store = new SharedStore(resolve(dataDir, "shared-views.sqlite"));
  app.get("/api/shared-views", auth, (req, res) =>
    res.json(
      store
        .list(req.session.accountId)
        .map((v) => sharedInfo(v, req.session.accountId)),
    ),
  );
  app.post("/api/shared-views", auth, (req, res) => {
    const v = store.create(
      req.session.accountId,
      getAccount(req.session.accountId).email,
      definition.parse(req.body),
    );
    res.status(201).json(sharedInfo(v, req.session.accountId));
  });
  app.get("/api/shared-views/:id", auth, (req, res) =>
    res.json(
      sharedInfo(
        store.member(req.params.id, req.session.accountId),
        req.session.accountId,
      ),
    ),
  );
  app.patch("/api/shared-views/:id", auth, (req, res) => {
    store.owner(req.params.id, req.session.accountId);
    const patch = definition.parse(req.body);
    const v = store.mutate(req.params.id, (v) => {
      Object.assign(v, patch);
    });
    res.json(sharedInfo(v, req.session.accountId));
  });
  app.delete("/api/shared-views/:id", auth, (req, res) => {
    store.delete(req.params.id, req.session.accountId);
    res.json({ ok: true });
  });
  app.put("/api/shared-views/:id/contributions", auth, async (req, res) => {
    store.member(req.params.id, req.session.accountId);
    const selected = contributions.parse(req.body.contributions);
    const available = selected.length
      ? await allPages(
          req.session.accountId,
          "users/me/calendarList?maxResults=250",
          { cache: false },
        )
      : [];
    if (selected.some((c) => !available.some((a) => a.id === c.calendarId)))
      return res
        .status(403)
        .json({ error: "Choose calendars from your own Google account." });
    const v = store.mutate(req.params.id, (v) => {
      if (!v.members[req.session.accountId])
        throw Object.assign(new Error("Membership removed."), { status: 403 });
      v.members[req.session.accountId].contributions = selected;
    });
    res.json(sharedInfo(v, req.session.accountId));
  });
  app.delete("/api/shared-views/:id/members/:memberId", auth, (req, res) => {
    const v = store.member(req.params.id, req.session.accountId);
    const target = req.params.memberId;
    if (target === v.ownerId)
      return res
        .status(400)
        .json({ error: "The owner must delete the view instead of leaving." });
    if (target !== req.session.accountId && v.ownerId !== req.session.accountId)
      return res
        .status(403)
        .json({ error: "Only the owner can remove another member." });
    store.mutate(v.id, (v) => {
      delete v.members[target];
    });
    res.json({ ok: true });
  });
  app.post("/api/shared-views/:id/invitations", auth, (req, res) => {
    const { email } = z.object({ email: z.email().max(254) }).parse(req.body);
    const token = store.invite(
      req.params.id,
      req.session.accountId,
      email.toLowerCase(),
    );
    res.status(201).json({ url: `${appUrl}/#invite=${token}` });
  });
  app.delete(
    "/api/shared-views/:id/invitations/:inviteId",
    auth,
    (req, res) => {
      store.owner(req.params.id, req.session.accountId);
      store.mutate(req.params.id, (v) => {
        v.invitations = v.invitations.filter(
          (i) => i.id !== req.params.inviteId,
        );
      });
      res.json({ ok: true });
    },
  );
  app.get("/api/shared-invitations/:token", (req, res) => {
    const v = store.invitation(req.params.token);
    res.json({ name: v.name });
  });
  app.post("/api/shared-invitations/:token/accept", auth, (req, res) => {
    const v = store.accept(
      req.params.token,
      req.session.accountId,
      getAccount(req.session.accountId).email,
    );
    res.json(sharedInfo(v, req.session.accountId));
  });
  app.post("/api/shared-views/:id/links", auth, (req, res) => {
    const { scope } = z
      .object({ scope: z.enum(["web", "ical"]) })
      .parse(req.body);
    const token = store.link(req.params.id, req.session.accountId, scope);
    res.status(201).json({
      url:
        scope === "web"
          ? `${appUrl}/#share=${token}`
          : `${appUrl}/api/shared-links/${token}/calendar.ics`,
    });
  });
  app.delete("/api/shared-views/:id/links/:linkId", auth, (req, res) => {
    store.owner(req.params.id, req.session.accountId);
    store.mutate(req.params.id, (v) => {
      v.links = v.links.filter((l) => l.id !== req.params.linkId);
    });
    res.json({ ok: true });
  });
  app.get("/api/shared-views/:id/events", auth, async (req, res) => {
    const v = store.member(req.params.id, req.session.accountId);
    const { from, to } = range.parse(req.query);
    const data = await aggregateShared(v, from, to);
    ensureUnchanged(v, store.member(v.id, req.session.accountId));
    res.json(data);
  });
  app.get("/api/shared-links/:token", async (req, res) => {
    const v = store.publicView(req.params.token, "web");
    const { from, to } = range.parse(req.query);
    const data = await aggregateShared(v, from, to, true);
    ensureUnchanged(v, store.publicView(req.params.token, "web"));
    res.set("Cache-Control", "no-store").json({
      name: v.name,
      layout: v.layout,
      continuousScroll: !!v.continuousScroll,
      ...data,
    });
  });
  app.get("/api/shared-links/:token/calendar.ics", async (req, res) => {
    const v = store.publicView(req.params.token, "ical");
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const to = new Date(from);
    to.setDate(to.getDate() + 365);
    const data = await aggregateShared(
      v,
      from.toISOString(),
      to.toISOString(),
      true,
    );
    ensureUnchanged(v, store.publicView(req.params.token, "ical"));
    res
      .set({
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": 'inline; filename="hypercal-shared.ics"',
      })
      .send(sharedICS(data.events, v.name));
  });
  return store;
}
