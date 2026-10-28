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
  const result = await client.request({
    url: `https://www.googleapis.com/calendar/v3/${path}`,
    method,
    data: body,
    headers: etag ? { "If-Match": etag } : undefined,
  });
  return result.data;
}
export async function allPages(id, path) {
  let items = [],
    pageToken;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const data = await googleRequest(
      id,
      path +
        (pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : ""),
    );
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}
export function normalizeEvent(e, calendar) {
  return {
    id: e.id,
    calendarId: calendar.id,
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
    recurring: !!e.recurringEventId,
    htmlLink: e.htmlLink,
  };
}
