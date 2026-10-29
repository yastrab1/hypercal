import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAccount, upsertAccount, listAccountIds } from "./store.mjs";
import { allPages, googleRequest, normalizeEvent } from "./google.mjs";
import { googleTagFields, readEventTags, tagKey } from "./tags.mjs";
import { applyTagAliases } from "./tag-aliases.mjs";
export function registerTagCrud(app, auth, cache, invalidate) {
  const running = new Set();
  async function sync(id) {
    if (running.has(id)) return;
    running.add(id);
    try {
      for (const job of [...(getAccount(id).tagJobs || [])]) {
        try {
          const calendars = (
            await allPages(id, "users/me/calendarList?maxResults=250")
          ).filter((c) => ["writer", "owner"].includes(c.accessRole));
          for (const cal of calendars) {
            const query = new URLSearchParams({
              sharedExtendedProperty: `${tagKey(job.from)}=1`,
              maxResults: "2500",
              singleEvents: "false",
            });
            const indexed = await allPages(
              id,
              `calendars/${encodeURIComponent(cal.id)}/events?${query}`,
            );
            const candidates = [
              ...indexed.map((e) => e.recurringEventId || e.id),
              ...(job.candidates || [])
                .filter((e) => e.calendarId === cal.id)
                .map((e) => e.recurringEventId || e.id),
            ];
            for (const eventId of new Set(candidates)) {
              let source;
              try {
                source = await googleRequest(
                  id,
                  `calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}`,
                );
              } catch (error) {
                if (
                  [404, 410].includes(
                    error.response?.status || error.status || error.code,
                  )
                )
                  continue;
                throw error;
              }
              if (source.status === "cancelled") continue;
              const before = readEventTags(source);
              if (!before.includes(job.from)) continue;
              const after = applyTagAliases(before, getAccount(id).tagAliases);
              const result = await googleRequest(
                id,
                `calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}`,
                {
                  method: "PATCH",
                  etag: source.etag,
                  body: { extendedProperties: googleTagFields(after, before) },
                },
              );
              cache.remember(
                id,
                [normalizeEvent(result, { ...cal, _hypercalAccountId: id })],
                { local: true },
              );
            }
          }
          upsertAccount(id, {
            tagJobs: (getAccount(id).tagJobs || []).filter(
              (j) => j.id !== job.id,
            ),
          });
        } catch {
          upsertAccount(id, {
            tagJobs: (getAccount(id).tagJobs || []).map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    lastError:
                      "Google sync is pending; changes are saved and will retry.",
                  }
                : j,
            ),
          });
          break;
        }
      }
    } finally {
      running.delete(id);
    }
  }
  function change(id, from, to, color) {
    const account = getAccount(id),
      tag = account.tags?.find((t) => t.name === from);
    if (!tag)
      throw Object.assign(new Error("Tag not found."), {
        status: 404,
        expose: true,
      });
    if (to !== null && to !== from && account.tags.some((t) => t.name === to))
      throw Object.assign(new Error("That tag already exists."), {
        status: 409,
        expose: true,
      });
    if (to === from) {
      upsertAccount(id, {
        tags: account.tags.map((t) => (t.name === from ? { ...t, color } : t)),
      });
      return;
    }
    const aliases = { ...account.tagAliases };
    for (const [name, value] of Object.entries(aliases))
      if (value === from) aliases[name] = to;
    aliases[from] = to;
    if (to) delete aliases[to];
    const cached = cache.events(id).filter((e) => e.tags.includes(from));
    const job = {
      id: randomUUID(),
      from,
      to,
      candidates: cached.map(({ calendarId, id, recurringEventId }) => ({
        calendarId,
        id,
        recurringEventId,
      })),
    };
    upsertAccount(id, {
      tags:
        to === null
          ? account.tags.filter((t) => t.name !== from)
          : account.tags.map((t) =>
              t.name === from ? { name: to, color } : t,
            ),
      tagTracking: Object.fromEntries(
        Object.entries(account.tagTracking || {}).map(([key, value]) => [
          key,
          value === from ? to : value,
        ]),
      ),
      tagAliases: aliases,
      tagJobs: [...(account.tagJobs || []), job],
    });
    cache.remember(
      id,
      cached.map((e) => ({
        ...e,
        tags: applyTagAliases(e.tags, { [from]: to }),
      })),
      { local: true },
    );
    invalidate(id);
    void sync(id);
  }
  const state = (id) => ({
    tags: getAccount(id).tags || [],
    tracking: getAccount(id).tagTracking || {},
    pending: !!getAccount(id).tagJobs?.length,
  });
  app.patch("/api/tags/:name", auth, (req, res) => {
    const { name, color } = z
      .object({
        name: z.string().trim().min(1).max(60),
        color: z.string().regex(/^#[\da-f]{6}$/i),
      })
      .parse(req.body);
    change(req.session.accountId, req.params.name, name, color);
    res.json(state(req.session.accountId));
  });
  app.delete("/api/tags/:name", auth, (req, res) => {
    change(req.session.accountId, req.params.name, null, null);
    res.json(state(req.session.accountId));
  });
  app.get("/api/tag-sync", auth, (req, res) =>
    res.json({
      pending: getAccount(req.session.accountId).tagJobs?.length || 0,
      error:
        getAccount(req.session.accountId).tagJobs?.find((j) => j.lastError)
          ?.lastError || null,
    }),
  );
  const timer = setInterval(() => {
    for (const id of listAccountIds())
      if (getAccount(id).tagJobs?.length) void sync(id);
  }, 30000);
  timer.unref();
  return { sync, close: () => clearInterval(timer) };
}
