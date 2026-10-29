import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const PENDING_MS = 5 * 60_000;
const startDate = (value) =>
  new Date(value.length === 10 ? value + "T00:00:00" : value);
const key = (e) => JSON.stringify([e.calendarId, e.id]);
const overlaps = (e, from, to) =>
  startDate(e.start) < new Date(to) && startDate(e.end) > new Date(from);
// Only tagged events and short-lived write tombstones are retained. Per-account
// files live inside the application's existing persistent private data volume.
export class TagCache {
  constructor(root, now = Date.now) {
    this.root = root;
    this.now = now;
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  file(account) {
    return join(
      this.root,
      createHash("sha256").update(account).digest("hex") + ".json",
    );
  }
  read(account) {
    try {
      const data = JSON.parse(readFileSync(this.file(account), "utf8"));
      return data.version === 1 &&
        data.events &&
        typeof data.events === "object"
        ? data
        : { version: 1, events: {} };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      return { version: 1, events: {} };
    }
  }
  write(account, data) {
    const file = this.file(account),
      temp = file + "." + randomUUID() + ".tmp";
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    renameSync(temp, file);
    chmodSync(file, 0o600);
  }
  merge(data, event, local = false) {
    const id = key(event),
      old = data.events[id];
    const pending = old?.writeAt && this.now() - old.writeAt < PENDING_MS;
    if (!local && pending) {
      // Read-after-write may lag in Google's list/search index. A direct matching
      // response must not release the grace window: another index may still lag.
      if (old.deleted) return null;
      if (
        old.event.etag !== event.etag ||
        JSON.stringify(old.event.tags || []) !==
          JSON.stringify(event.tags || [])
      )
        return old.event;
    }
    if (event.tags?.length || local || pending)
      data.events[id] = {
        event,
        writeAt: local ? this.now() : pending ? old.writeAt : 0,
      };
    else delete data.events[id];
    return event;
  }
  remember(account, events, { local = false } = {}) {
    const data = this.read(account);
    const merged = events
      .map((e) => this.merge(data, e, local))
      .filter(Boolean);
    this.write(account, data);
    return merged;
  }
  range(account, calendarId, from, to, events) {
    const data = this.read(account),
      seen = new Set(events.map(key));
    const merged = events.map((e) => this.merge(data, e)).filter(Boolean);
    for (const [id, record] of Object.entries(data.events)) {
      const e = record.event;
      if (e.calendarId !== calendarId || seen.has(id) || !overlaps(e, from, to))
        continue;
      if (record.writeAt && this.now() - record.writeAt < PENDING_MS) {
        if (!record.deleted) merged.push(e);
      } else delete data.events[id];
    }
    this.write(account, data);
    return merged;
  }
  forget(account, calendarId, eventId) {
    const data = this.read(account);
    delete data.events[key({ calendarId, id: eventId })];
    this.write(account, data);
  }
  remove(account, calendarId, eventId) {
    const data = this.read(account),
      id = key({ calendarId, id: eventId }),
      old = data.events[id];
    if (old) data.events[id] = { ...old, deleted: true, writeAt: this.now() };
    this.write(account, data);
  }
  events(account) {
    return Object.values(this.read(account).events)
      .filter((r) => !r.deleted && r.event.tags?.length)
      .map((r) => r.event);
  }
  nearest(account, name, allowedCalendars, now = new Date(this.now())) {
    return (
      this.events(account)
        .filter(
          (e) =>
            allowedCalendars.includes(e.calendarId) &&
            e.tags.includes(name) &&
            startDate(e.end) > now,
        )
        .sort((a, b) => startDate(a.start) - startDate(b.start))[0] || null
    );
  }
}
