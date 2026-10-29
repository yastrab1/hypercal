const PREFIX = "hypercal.cache.v1.";
const MAX_AGE = 14 * 86400000;
const MAX_RANGES = 6;
export function createCalendarCache(storage, now = Date.now) {
  const decoded = new Map();
  const read = (key) => {
    try {
      const raw = storage.getItem(key) || "null";
      const previous = decoded.get(key);
      if (previous?.raw === raw) return previous.value;
      const value = JSON.parse(raw);
      decoded.set(key, { raw, value });
      if (decoded.size > 2) decoded.delete(decoded.keys().next().value);
      return value;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
      decoded.delete(key);
      return true;
    } catch {
      return false;
    }
  };
  const readAccount = (id) => {
    const data = read(PREFIX + id);
    if (
      data?.user?.id !== id ||
      typeof data.user.email !== "string" ||
      !Array.isArray(data.calendars) ||
      !Array.isArray(data.views) ||
      !data.ranges ||
      typeof data.ranges !== "object" ||
      now() - data.updatedAt >= MAX_AGE ||
      !Number.isFinite(data.updatedAt)
    )
      return null;
    const ranges = Object.fromEntries(
      Object.entries(data.ranges).filter(
        ([, range]) =>
          range &&
          Array.isArray(range.events) &&
          typeof range.refreshedAt === "string" &&
          Number.isFinite(range.savedAt) &&
          now() - range.savedAt < MAX_AGE,
      ),
    );
    return { ...data, ranges };
  };
  const save = (data) => {
    if (!write(PREFIX + data.user.id, data)) {
      data.ranges = {};
      write(PREFIX + data.user.id, data);
    }
    write(PREFIX + "last", data.user.id);
  };
  return {
    readAccount,
    readLast() {
      const id = read(PREFIX + "last");
      return typeof id === "string" ? readAccount(id) : null;
    },
    writeMetadata(user, calendars, views) {
      const old = readAccount(user.id);
      save({
        user: { id: user.id, email: user.email },
        calendars,
        views,
        ranges: old?.ranges || {},
        updatedAt: now(),
      });
    },
    readRange(id, key) {
      const range = readAccount(id)?.ranges?.[key];
      return range && now() - range.savedAt < MAX_AGE ? range : null;
    },
    writeRange(user, key, events, refreshedAt) {
      const data = readAccount(user.id);
      if (!data) return;
      data.ranges[key] = { events, refreshedAt, savedAt: now() };
      data.ranges = Object.fromEntries(
        Object.entries(data.ranges)
          .sort((a, b) => b[1].savedAt - a[1].savedAt)
          .slice(0, MAX_RANGES),
      );
      data.updatedAt = now();
      save(data);
    },
    invalidateEvents(id) {
      const data = readAccount(id);
      if (data) {
        data.ranges = {};
        save(data);
      }
    },
    forget() {
      decoded.clear();
      try {
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (key?.startsWith(PREFIX)) storage.removeItem(key);
        }
      } catch {}
    },
  };
}
