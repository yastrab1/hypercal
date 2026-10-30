import { ReadCache, canonicalPath, createLimiter } from "./read-cache.mjs";
import { resolve } from "node:path";
import { dataDir } from "./store.mjs";
import { createSingleFlight } from "./singleflight.mjs";
import { applyTagAliases } from "./tag-aliases.mjs";
import { readEventTags } from "./tags.mjs";
import { readEventColor } from "../src/event-colors.mjs";
import { OAuth2Client } from "google-auth-library";
import { readFileSync } from "node:fs";
import { getAccount, upsertAccount } from "./store.mjs";
let credentials = {};
if (process.env.GOOGLE_CREDENTIALS_FILE) {
  const c = JSON.parse(
    readFileSync(process.env.GOOGLE_CREDENTIALS_FILE, "utf8"),
  );
  credentials = c.web || c.installed || c;
}
const clientId = process.env.GOOGLE_CLIENT_ID || credentials.client_id;
const clientSecret =
  process.env.GOOGLE_CLIENT_SECRET || credentials.client_secret;
export const configured = !!(clientId && clientSecret);
export const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendars",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
export function oauth() {
  return new OAuth2Client(
    clientId,
    clientSecret,
    `${process.env.APP_URL || "http://localhost:5173"}/auth/google/callback`,
  );
}
export async function clientFor(id) {
  const a = getAccount(id);
  if (!a?.tokens)
    throw Object.assign(new Error("Connect your Google account first."), {
      status: 401,
    });
  const client = oauth();
  client.setCredentials(a.tokens);
  client.on("tokens", (tokens) =>
    upsertAccount(id, { tokens: { ...getAccount(id).tokens, ...tokens } }),
  );
  return client;
}
export async function googleRequest(
  id,
  path,
  { method = "GET", body, etag } = {},
) {
  const client = await clientFor(id);
  const mutation = method.toUpperCase() !== "GET";
  if (mutation) await invalidateGoogleCache(id);
  try {
    const result = await client.request({
      url: `https://www.googleapis.com/calendar/v3/${path}`,
      method,
      data: body,
      headers: etag ? { "If-Match": etag } : undefined,
    });
    return result.data;
  } finally {
    // A refresh after a write must not join a read started before/during it.
    if (mutation) await invalidateGoogleCache(id);
  }
}
const concurrentReads = createSingleFlight();
const diskReads = new ReadCache(resolve(dataDir, "google-read-cache"));
const providerReads = createLimiter(4);
const cooldowns = new Map();
export async function invalidateGoogleCache(id) {
  const prefix = JSON.stringify([id]).slice(0, -1) + ",";
  concurrentReads.invalidate((key) => key.startsWith(prefix));
  await diskReads.invalidate(id);
}
export function allPages(id, path, { cache = true } = {}) {
  if (!getAccount(id)?.tokens)
    return Promise.reject(
      Object.assign(new Error("Connect your Google account first."), {
        status: 401,
      }),
    );
  const canonical = canonicalPath(path);
  return concurrentReads(JSON.stringify([id, canonical, cache]), () => {
    const load = () =>
      providerReads(async () => {
        if ((cooldowns.get(id) || 0) > Date.now())
          throw Object.assign(
            new Error(
              "Google Calendar rate limit reached. Please retry shortly.",
            ),
            { status: 429 },
          );
        try {
          return await loadAllPages(id, path);
        } catch (error) {
          const status = error.response?.status || error.status || error.code;
          const reason = error.response?.data?.error?.errors?.[0]?.reason;
          if (
            status === 429 ||
            (status === 403 &&
              /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(
                reason || "",
              ))
          )
            cooldowns.set(id, Date.now() + 60000);
          throw error;
        }
      });
    const ttl = path.startsWith("users/me/calendarList") ? 60000 : 5 * 60000;
    // Cache list/range reads only. Direct event reads used for edits/conflicts
    // always use googleRequest and go straight to the provider.
    return cache ? diskReads.read(id, path, ttl, load) : load();
  });
}
async function loadAllPages(id, path) {
  let items = [],
    pageToken;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const data = await googleRequest(
      id,
      path +
        (pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : ""),
    );
    items.push(
      ...(data.items || []).map((item) =>
        path.startsWith("users/me/calendarList")
          ? { ...item, _hypercalAccountId: id }
          : item,
      ),
    );
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}
export function normalizeEvent(
  e,
  calendar,
  accountId = calendar._hypercalAccountId,
) {
  return {
    id: e.id,
    calendarId: calendar.id,
    tags: applyTagAliases(readEventTags(e), getAccount(accountId)?.tagAliases),
    title: e.summary || "Untitled event",
    description: e.description || "",
    location: e.location || "",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: !!e.start?.date,
    readOnly: !["owner", "writer"].includes(calendar.accessRole),
    source: "google",
    timeZone: e.start?.timeZone,
    color: readEventColor(e),
    reminderMinutes: e.reminders?.useDefault
      ? undefined
      : (e.reminders?.overrides?.find((x) => x.method === "popup")?.minutes ??
        (e.reminders?.overrides?.length === 0 ? null : undefined)),
    etag: e.etag,
    recurring: !!(e.recurringEventId || e.recurrence?.length),
    recurringEventId: e.recurringEventId,
    originalStartTime: e.originalStartTime,
    htmlLink: e.htmlLink,
  };
}
