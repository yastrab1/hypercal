import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class PluginStore {
  constructor(directory, now = Date.now) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, "plugins.json");
    this.now = now;
    try {
      this.data = JSON.parse(readFileSync(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.data = { instances: [] };
    }
    for (const instance of this.data.instances) {
      if (["running", "queued"].includes(instance.status)) {
        instance.status = "interrupted";
        instance.message =
          "The server restarted. Sync resumes on the next trigger.";
      }
    }
    this.save();
  }
  save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.data), {
      mode: 0o600,
    });
    renameSync(this.file + ".tmp", this.file);
    chmodSync(this.file, 0o600);
  }
  list(owner) {
    return this.data.instances.filter((i) => i.owner === owner && !i.archived);
  }
  get(owner, id) {
    const found = this.list(owner).find((i) => i.id === id);
    if (!found)
      throw Object.assign(new Error("Plugin not found."), { status: 404 });
    return found;
  }
  add(owner, config) {
    const instance = {
      ...config,
      id: randomUUID(),
      owner,
      revision: 1,
      connected: false,
      enabled: false,
      status: "disconnected",
      message: "Connect EduPage to start importing.",
      history: [],
      sources: {},
      createdAt: this.now(),
    };
    this.data.instances.push(instance);
    this.save();
    return instance;
  }
  update(owner, id, patch) {
    const instance = this.get(owner, id);
    Object.assign(instance, patch, { revision: instance.revision + 1 });
    this.save();
    return instance;
  }
  public(instance) {
    const { owner, sources, webhookHash, ...safe } = instance;
    return {
      ...safe,
      importedCount: Object.keys(sources).length,
      webhookConfigured: !!webhookHash,
    };
  }
}

export class PluginRunner {
  constructor(store, execute, { now = Date.now, concurrency = 1 } = {}) {
    this.store = store;
    this.execute = execute;
    this.now = now;
    this.concurrency = concurrency;
    this.active = new Set();
    this.queue = [];
    this.closed = false;
  }
  enqueue(instance, reason, { force = false } = {}) {
    if (
      this.closed ||
      !instance.enabled ||
      !instance.connected ||
      this.active.has(instance.id)
    )
      return false;
    const queued = this.queue.find((job) => job.id === instance.id);
    if (queued) {
      if (force) {
        queued.revision = instance.revision;
        queued.reason = reason;
      }
      return false;
    }
    if (
      !force &&
      instance.queuedAt !== undefined &&
      this.now() - instance.queuedAt < 60000
    )
      return false;
    Object.assign(instance, {
      status: "queued",
      queuedAt: this.now(),
      message: "Waiting to sync…",
    });
    this.queue.push({
      id: instance.id,
      owner: instance.owner,
      revision: instance.revision,
      reason,
    });
    this.store.save();
    queueMicrotask(() => this.pump());
    return true;
  }
  activate(owner) {
    let queued = 0;
    for (const instance of this.store.list(owner))
      if (instance.trigger === "open" && this.enqueue(instance, "app opened"))
        queued++;
    return queued;
  }
  tick() {
    for (const instance of this.store.data.instances)
      if (
        instance.trigger === "interval" &&
        (instance.queuedAt === undefined ||
          this.now() - instance.queuedAt >= instance.intervalMinutes * 60000)
      )
        this.enqueue(instance, "schedule");
  }
  async pump() {
    if (this.closed || this.active.size >= this.concurrency) return;
    const job = this.queue.shift();
    if (!job) return;
    const instance = this.store.get(job.owner, job.id);
    if (!instance.enabled || instance.revision !== job.revision) {
      this.pump();
      return;
    }
    this.active.add(job.id);
    Object.assign(instance, {
      status: "running",
      startedAt: this.now(),
      message: "Reading EduPage…",
    });
    this.store.save();
    try {
      const result = await this.execute(instance, () => {
        const current = this.store.get(job.owner, job.id);
        if (!current.enabled || current.revision !== job.revision)
          throw new Error(
            "Settings changed during sync. The next trigger will use the new settings.",
          );
      });
      Object.assign(instance, {
        status: "success",
        message: result.message,
        lastResult: result,
        lastSuccessAt: this.now(),
      });
    } catch (error) {
      Object.assign(instance, {
        status: error.code === "EDUPAGE_LOGIN" ? "disconnected" : "error",
        message: error.message || "Sync failed. Please reconnect EduPage.",
      });
      if (error.code === "EDUPAGE_LOGIN") instance.connected = false;
    } finally {
      instance.finishedAt = this.now();
      instance.history.unshift({
        at: instance.finishedAt,
        status: instance.status,
        message: instance.message,
        reason: job.reason,
      });
      instance.history = instance.history.slice(0, 20);
      this.store.save();
      this.active.delete(job.id);
      this.pump();
    }
  }
  close() {
    this.closed = true;
    this.queue = [];
  }
}
