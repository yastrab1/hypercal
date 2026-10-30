import { createPluginApi } from "./plugin-api.mjs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { PluginStore, PluginRunner } from "./plugin-store.mjs";
import {
  excludePattern,
  syncAssignments,
  filteredAssignments,
} from "./plugin-sync.mjs";
import { dataDir, getAccount } from "./store.mjs";
import { googleRequest, allPages } from "./google.mjs";
import { schoolOrigin } from "../worker/edupage.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const catalog = [
  {
    id: "edupage",
    name: "EduPage",
    description: "Import upcoming homework and exams into a Google calendar.",
    capabilities: ["events.read", "events.write", "calendars.read"],
    triggers: ["open", "interval", "webhook"],
  },
];
const configSchema = z.object({
  type: z.literal("edupage"),
  name: z.string().trim().min(1).max(80).default("EduPage"),
  schoolUrl: z.string().max(200).transform(schoolOrigin),
  calendarId: z.string().min(1).max(1024),
  enabled: z.boolean().default(false),
  trigger: z.enum(["open", "interval"]).default("open"),
  intervalMinutes: z.number().int().min(5).max(10080).default(60),
  homework: z.boolean().default(true),
  exams: z.boolean().default(true),
  excludeSubjects: z
    .array(z.string().trim().min(1).max(120))
    .max(100)
    .default([]),
  excludeRegex: z.string().max(500).default(""),
  webhookEnabled: z.boolean().default(false),
});
function workerToken() {
  const file =
    process.env.BROWSER_WORKER_TOKEN_FILE ||
    resolve(dataDir, "browser-worker-token");
  if (!existsSync(file))
    writeFileSync(file, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  return readFileSync(file, "utf8").trim();
}
export function createPluginService() {
  const store = new PluginStore(resolve(dataDir, "plugins"));
  const token = workerToken();
  const environmentLogin = (owner, school) => {
    const email = getAccount(owner)?.email?.toLowerCase();
    return !!(
      process.env.EDUPAGE_USERNAME &&
      process.env.EDUPAGE_PASSWORD &&
      process.env.EDUPAGE_OWNER_EMAIL?.toLowerCase() === email &&
      school ===
        (process.env.EDUPAGE_SCHOOL_URL || "https://smnd.edupage.org").replace(
          /\/$/,
          "",
        )
    );
  };
  const worker = async (instance, action, extra = {}) => {
    if (!process.env.BROWSER_WORKER_URL)
      throw Object.assign(
        new Error(
          "The EduPage browser service is not configured on this server.",
        ),
        { status: 503 },
      );
    const key = digest(`${instance.owner}:${instance.id}`);
    let response;
    try {
      response = await fetch(
        `${process.env.BROWSER_WORKER_URL}/${key}/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            schoolUrl: instance.schoolUrl,
            accountEmail: getAccount(instance.owner)?.email,
            ...extra,
          }),
          signal: AbortSignal.timeout(
            action === "scrape" || action === "finish" ? 90000 : 45000,
          ),
        },
      );
    } catch {
      throw new Error(
        "The EduPage browser service is unavailable. Your existing calendar events were kept.",
      );
    }
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(data.error || "EduPage connection failed."),
        { code: data.code, status: 400 },
      );
    return data;
  };
  const targetCalendar = async (owner, id) => {
    const calendars = await allPages(
      owner,
      "users/me/calendarList?maxResults=250",
      { cache: false },
    );
    const target = calendars.find(
      (c) => c.id === id && ["owner", "writer"].includes(c.accessRole),
    );
    if (!target)
      throw Object.assign(
        new Error("Choose a writable Google calendar for this plugin."),
        { status: 403 },
      );
    return target;
  };
  // Server-installed modules receive scoped capabilities, never OAuth tokens.
  const registry = new Map([
    [
      "edupage",
      async ({ instance, api }) => {
        const result = await worker(instance, "scrape");
        api.check();
        instance.subjects = result.subjects;
        instance.preview = result.items.slice(0, 12);
        instance.assignmentCount = result.items.length;
        store.save();
        return api.events.sync(result.items);
      },
    ],
  ]);
  const runner = new PluginRunner(store, async (instance, check) => {
    await targetCalendar(instance.owner, instance.calendarId);
    check();
    const execute = registry.get(instance.type);
    if (!execute)
      throw new Error("This plugin is not installed on the server.");
    const manifest = catalog.find((plugin) => plugin.id === instance.type);
    const api = createPluginApi(instance, {
      request: googleRequest,
      allPages,
      save: () => store.save(),
      check,
      capabilities: manifest.capabilities,
    });
    api.events.sync = (items) =>
      syncAssignments(instance, items, {
        request: googleRequest,
        save: () => store.save(),
        check,
      });
    return execute({ instance, api });
  });
  const timer = setInterval(() => runner.tick(), 15000);
  timer.unref();
  return {
    store,
    runner,
    worker,
    environmentLogin,
    targetCalendar,
    registry,
    close() {
      clearInterval(timer);
      runner.close();
    },
  };
}

export function registerPluginHooks(app, service) {
  app.post(
    "/hooks/plugins/:id",
    rateLimit({ windowMs: 60000, limit: 20 }),
    (req, res) => {
      const instance = service.store.data.instances.find(
        (i) => i.id === req.params.id && !i.archived,
      );
      const supplied = digest(
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      if (
        !instance?.webhookEnabled ||
        !instance.webhookHash ||
        !timingSafeEqual(
          Buffer.from(supplied),
          Buffer.from(instance.webhookHash),
        )
      )
        return res
          .status(401)
          .json({ error: "Invalid plugin webhook credentials." });
      const queued = service.runner.enqueue(instance, "webhook");
      res.status(202).json({ queued });
    },
  );
}
export function registerPlugins(app, auth, service, appUrl) {
  const { store, runner, worker, environmentLogin, targetCalendar } = service;
  const present = (instance) => ({
    ...store.public(instance),
    environmentLoginAvailable: environmentLogin(
      instance.owner,
      instance.schoolUrl,
    ),
  });
  app.get("/api/plugins", auth, (req, res) =>
    res.json({
      catalog,
      instances: store.list(req.session.accountId).map(present),
      browserConfigured: !!process.env.BROWSER_WORKER_URL,
      defaultSchoolUrl:
        process.env.EDUPAGE_SCHOOL_URL || "https://smnd.edupage.org",
      environmentLoginAvailable: environmentLogin(
        req.session.accountId,
        process.env.EDUPAGE_SCHOOL_URL || "https://smnd.edupage.org",
      ),
    }),
  );
  app.post("/api/plugins/activate", auth, (req, res) => {
    const queued = runner.activate(req.session.accountId);
    res.json({
      queued,
      running: store
        .list(req.session.accountId)
        .some((i) => ["queued", "running"].includes(i.status)),
      revision: Math.max(
        0,
        ...store.list(req.session.accountId).map((i) => i.lastSuccessAt || 0),
      ),
    });
  });
  app.post("/api/plugins", auth, async (req, res) => {
    if (store.list(req.session.accountId).length >= 10)
      return res
        .status(400)
        .json({ error: "At most ten plugins can be configured." });
    const config = configSchema.parse(req.body);
    excludePattern(config.excludeRegex);
    await targetCalendar(req.session.accountId, config.calendarId);
    const instance = store.add(req.session.accountId, config);
    if (
      config.enabled &&
      environmentLogin(instance.owner, instance.schoolUrl)
    ) {
      Object.assign(instance, { enabled: true, connected: true });
      store.save();
      runner.enqueue(instance, "enabled", { force: true });
    }
    res.status(201).json(present(instance));
  });
  app.patch("/api/plugins/:id", auth, async (req, res) => {
    const prior = store.get(req.session.accountId, req.params.id);
    const config = configSchema.parse(req.body);
    excludePattern(config.excludeRegex);
    await targetCalendar(req.session.accountId, config.calendarId);
    const changedSchool = config.schoolUrl !== prior.schoolUrl;
    const connected =
      (!changedSchool && prior.connected) ||
      environmentLogin(prior.owner, config.schoolUrl);
    const instance = store.update(req.session.accountId, prior.id, {
      ...config,
      connected,
      enabled: config.enabled && connected,
    });
    if (!instance.enabled) {
      instance.status = connected ? "paused" : "disconnected";
      instance.message = connected
        ? "Automatic sync paused."
        : "Connect EduPage or configure server credentials.";
      store.save();
    } else runner.enqueue(instance, "settings saved", { force: true });
    res.json(present(instance));
  });
  app.delete("/api/plugins/:id", auth, (req, res) => {
    const instance = store.update(req.session.accountId, req.params.id, {
      enabled: false,
      archived: true,
      status: "removed",
      webhookHash: null,
      webhookEnabled: false,
    });
    runner.queue = runner.queue.filter((j) => j.id !== instance.id);
    worker(instance, "cancel").catch(() => {});
    res.json({ ok: true });
  });
  app.post("/api/plugins/:id/restore", auth, (req, res) => {
    const instance = store.data.instances.find(
      (i) => i.id === req.params.id && i.owner === req.session.accountId,
    );
    if (!instance) return res.sendStatus(404);
    Object.assign(instance, {
      archived: false,
      enabled: false,
      status: "paused",
    });
    store.save();
    res.json(present(instance));
  });
  app.post("/api/plugins/:id/webhook", auth, (req, res) => {
    const token = randomBytes(32).toString("hex");
    const instance = store.update(req.session.accountId, req.params.id, {
      webhookHash: digest(token),
      webhookEnabled: true,
    });
    res.json({ url: `${appUrl}/hooks/plugins/${instance.id}`, token });
  });
  app.post("/api/plugins/:id/browser/:action", auth, async (req, res) => {
    const instance = store.get(req.session.accountId, req.params.id);
    const action = z
      .enum(["open", "snapshot", "input", "finish", "cancel"])
      .parse(req.params.action);
    const data = await worker(
      instance,
      action,
      action === "input" ? { input: req.body.input } : {},
    );
    if (action === "finish") {
      instance.connected = true;
      instance.subjects = data.subjects;
      instance.preview = filteredAssignments(data.items, instance).slice(0, 12);
      instance.assignmentCount = data.items.length;
      instance.status = "paused";
      instance.message =
        "Connected. Save with automatic sync enabled to start importing.";
      store.save();
      return res.json(present(instance));
    }
    res.json(data);
  });
}
