import ICAL from "ical.js";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
// Feeds may be fetched only from public HTTP(S) hosts, never the tailnet or LAN.
export function isPrivateIP(ip) {
  if (ip.includes(":")) {
    const x = ip.toLowerCase();
    return !/^[23][0-9a-f]{0,3}:/.test(x);
  }
  const p = ip.split(".").map(Number);
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && [18, 19].includes(p[1]))
  );
}
export async function validateFeedUrl(input) {
  const url = new URL(input.replace(/^webcal:/i, "https:"));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !["", "80", "443"].includes(url.port)
  )
    throw new Error("Use a public HTTP or HTTPS calendar URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((x) => isPrivateIP(x.address)))
    throw new Error(
      "Private network URLs are not supported for subscriptions.",
    );
  return url;
}
// Pin the DNS address verified above to the outbound socket to prevent DNS rebinding.
async function download(url) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((x) => isPrivateIP(x.address)))
    throw new Error(
      "Private network URLs are not supported for subscriptions.",
    );
  const address = addresses.find((a) => a.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(
      url,
      {
        headers: { Accept: "text/calendar" },
        lookup: (hostname, options, callback) =>
          options?.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
      },
      (response) => {
        const status = response.statusCode || 500;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location: response.headers.location });
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`Calendar provider returned ${status}.`));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) {
            request.destroy(
              new Error("Calendar exceeds the 4 MB prototype limit."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({ status, text: Buffer.concat(chunks).toString("utf8") }),
        );
        response.on("error", reject);
      },
    );
    const timeout = setTimeout(
      () => request.destroy(new Error("Calendar provider timed out.")),
      12000,
    );
    request.on("close", () => clearTimeout(timeout));
    request.on("error", reject);
  });
}
export async function fetchCalendar(input) {
  let url = await validateFeedUrl(input);
  for (let i = 0; i < 4; i++) {
    const response = await download(url);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location)
        throw new Error("Calendar redirect has no destination.");
      url = await validateFeedUrl(new URL(response.location, url).href);
      continue;
    }
    const text = response.text;
    if (!text.includes("BEGIN:VCALENDAR"))
      throw new Error("This link did not return an iCalendar feed.");
    return text;
  }
  throw new Error("Too many calendar redirects.");
}
export function parseFeed(text, subscription, from, to) {
  const root = new ICAL.Component(ICAL.parse(text));
  // Register VTIMEZONE definitions before expanding local recurrence rules.
  for (const zone of root.getAllSubcomponents("vtimezone")) {
    const id = zone.getFirstPropertyValue("tzid");
    if (id) ICAL.TimezoneService.register(id, new ICAL.Timezone(zone));
  }
  const components = root.getAllSubcomponents("vevent");
  const exceptions = new Map();
  for (const c of components) {
    const e = new ICAL.Event(c);
    if (e.isRecurrenceException()) {
      const arr = exceptions.get(e.uid) || [];
      arr.push(e);
      exceptions.set(e.uid, arr);
    }
  }
  const result = [];
  const min = new Date(from);
  const max = new Date(to);
  const add = (event, start, end, key) => {
    if (
      end.toJSDate() <= min ||
      start.toJSDate() >= max ||
      event.component.getFirstPropertyValue("status") === "CANCELLED"
    )
      return;
    result.push({
      id: `${subscription.id}:${event.uid}:${key}`,
      calendarId: subscription.id,
      tags: event.component
        .getAllProperties("categories")
        .flatMap((p) => p.getValues())
        .filter((x) => typeof x === "string"),
      title: event.summary || "Untitled event",
      description: event.description || "",
      location: event.location || "",
      start: start.isDate
        ? start.toString().slice(0, 10)
        : start.toJSDate().toISOString(),
      end: end.isDate
        ? end.toString().slice(0, 10)
        : end.toJSDate().toISOString(),
      allDay: start.isDate,
      readOnly: true,
      source: "ical",
    });
  };
  for (const c of components) {
    const e = new ICAL.Event(c);
    if (e.isRecurrenceException()) continue;
    if (!e.startDate) continue;
    if (e.isRecurring()) {
      for (const ex of exceptions.get(e.uid) || []) e.relateException(ex);
      const iterator = e.iterator();
      let next;
      let n = 0;
      while ((next = iterator.next()) && n++ < 100000) {
        if (next.toJSDate() >= max) break;
        const occurrence = e.getOccurrenceDetails(next);
        add(
          occurrence.item,
          occurrence.startDate,
          occurrence.endDate,
          next.toString(),
        );
      }
      if (n >= 100000)
        throw new Error("This feed has too many recurrence instances.");
    } else add(e, e.startDate, e.endDate, e.startDate.toString());
  }
  return result;
}
