import {
  mkdir,
  readdir,
  stat,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export function canonicalPath(path) {
  const url = new URL(path, "https://calendar.invalid/");
  for (const key of ["timeMin", "timeMax"])
    if (url.searchParams.has(key))
      url.searchParams.set(
        key,
        new Date(url.searchParams.get(key)).toISOString(),
      );
  url.searchParams.sort();
  return url.pathname + url.search;
}

// Private provider responses live in the existing persistent /data volume.
// Serialized file operations prevent writes racing an account invalidation.
export class ReadCache {
  constructor(
    directory,
    { maxBytes = 64 * 1024 * 1024, maxEntries = 512, now = Date.now } = {},
  ) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
    this.epochs = new Map();
    this.queue = this.init().catch(() => {
      console.warn(
        "Google read cache unavailable; reads will use the provider.",
      );
    });
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(name)) continue;
      const info = await stat(join(this.directory, name));
      this.entries.set(name, { bytes: info.size, used: info.mtimeMs });
    }
    await this.prune();
  }
  operation(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  async prune() {
    let bytes = [...this.entries.values()].reduce((n, e) => n + e.bytes, 0);
    const oldest = [...this.entries].sort((a, b) => a[1].used - b[1].used);
    for (const [name, entry] of oldest) {
      if (bytes <= this.maxBytes && this.entries.size <= this.maxEntries) break;
      await rm(join(this.directory, name), { force: true });
      this.entries.delete(name);
      bytes -= entry.bytes;
    }
  }
  async read(account, path, ttl, load) {
    if (this.disabled) return load();
    const prefix = hash(account);
    const name = `${prefix}-${hash(canonicalPath(path))}.json`;
    const epoch = this.epochs.get(prefix) || 0;
    const hit = await this.operation(async () => {
      if (!this.entries.has(name)) return null;
      try {
        const value = JSON.parse(
          await readFile(join(this.directory, name), "utf8"),
        );
        if (
          Array.isArray(value.items) &&
          value.savedAt <= this.now() &&
          this.now() - value.savedAt < ttl
        ) {
          this.entries.get(name).used = this.now();
          return value;
        }
      } catch {
        /* A corrupt entry is a miss, never a failed calendar load. */
      }
      await rm(join(this.directory, name), { force: true });
      this.entries.delete(name);
      return null;
    }).catch(() => null);
    if (hit) return hit.items;
    const items = await load();
    const data = JSON.stringify({ savedAt: this.now(), items });
    if (Buffer.byteLength(data) > this.maxBytes) return items;
    await this.operation(async () => {
      if ((this.epochs.get(prefix) || 0) !== epoch) return;
      const file = join(this.directory, name);
      await writeFile(file + ".tmp", data, { mode: 0o600 });
      await rename(file + ".tmp", file);
      this.entries.set(name, {
        bytes: Buffer.byteLength(data),
        used: this.now(),
      });
      await this.prune();
    }).catch(() => {
      console.warn("Google read cache write failed; returning provider data.");
    });
    return items;
  }
  invalidate(account) {
    const prefix = hash(account);
    this.epochs.set(prefix, (this.epochs.get(prefix) || 0) + 1);
    return this.operation(async () => {
      for (const name of this.entries.keys()) {
        if (!name.startsWith(prefix + "-")) continue;
        await rm(join(this.directory, name), { force: true });
        this.entries.delete(name);
      }
    }).catch(() => {
      // Never turn a successful upstream write into a failed save. Disable
      // cached reads if disk invalidation fails, rather than return stale data.
      this.disabled = true;
      console.warn(
        "Google read cache invalidation failed; cached reads disabled.",
      );
    });
  }
}

export function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  return async (load) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await load();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
