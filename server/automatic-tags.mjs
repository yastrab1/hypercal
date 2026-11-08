import { getAccount, upsertAccount } from "./store.mjs";
import { allPages, googleRequest, normalizeEvent } from "./google.mjs";
import { automaticEventTags, ruleCoversCalendar } from "./tag-rules.mjs";
import { readEventTags, googleTagFields } from "./tags.mjs";
import { applyTagAliases } from "./tag-aliases.mjs";

// One bounded background writer. Calendar scrolling never waits for Google writes.
export function createAutomaticTags(
  cache,
  { request = googleRequest, list = allPages } = {},
) {
  const queue = new Map(),
    scans = new Map(),
    details = new Map(),
    errors = new Map();
  let running = false,
    closed = false,
    activeOwner = null;
  const shape = (raw, calendarId) => ({
    calendarId,
    title: raw.summary || "",
    description: raw.description || "",
    location: raw.location || "",
    tags: readEventTags(raw),
  });
  const rawTags = (id, raw) =>
    applyTagAliases(readEventTags(raw), getAccount(id)?.tagAliases);
  const effective = (id, event) => ({
    ...event,
    tags: automaticEventTags(getAccount(id)?.tags, event),
  });
  const hasRules = (id) =>
    getAccount(id)?.tags?.some((tag) => tag.rule?.mode === "automatic");
  const desired = (id, raw, calendarId) =>
    automaticEventTags(getAccount(id)?.tags, {
      ...shape(raw, calendarId),
      tags: rawTags(id, raw),
    });
  const differs = (id, raw, calendarId) =>
    JSON.stringify(readEventTags(raw)) !==
    JSON.stringify(desired(id, raw, calendarId));
  const key = (id, cal, event) => JSON.stringify([id, cal, event]);
  async function detail(id, calendarId, eventId) {
    const k = key(id, calendarId, eventId),
      saved = details.get(k);
    if (saved && Date.now() - saved.at < 300000) return saved.raw;
    const raw = await request(
      id,
      `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    if (details.size > 1000) details.delete(details.keys().next().value);
    details.set(k, { at: Date.now(), raw });
    return raw;
  }
  async function work() {
    if (running || closed) return;
    running = true;
    let owner = null;
    try {
      // Each tick makes at most one upstream mutation. Repeated viewport loads
      // coalesce; fresh etags protect concurrent edits in Google and HyperCal.
      for (let batch = 0; batch < 50; batch++) {
        const job = queue.values().next().value;
        if (!job) return;
        queue.delete(key(job.id, job.calendar.id, job.raw.id));
        const { id, calendar, raw } = job;
        owner = id;
        activeOwner = id;
        if (!hasRules(id) || !differs(id, raw, calendar.id)) continue;
        let source;
        if (raw.recurringEventId) {
          const master = await detail(id, calendar.id, raw.recurringEventId);
          const text = (event) =>
            JSON.stringify([
              event.summary || "",
              event.description || "",
              event.location || "",
            ]);
          source =
            text(master) === text(raw)
              ? master
              : await detail(id, calendar.id, raw.id);
        } else source = await detail(id, calendar.id, raw.id);
        if (source.status === "cancelled" || !differs(id, source, calendar.id))
          continue;
        if (closed) return;
        const before = readEventTags(source),
          after = desired(id, source, calendar.id);
        const fields = googleTagFields(after, before);
        const result = await request(
          id,
          `calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(source.id)}`,
          {
            method: "PATCH",
            etag: source.etag,
            body: {
              extendedProperties: {
                ...source.extendedProperties,
                shared: {
                  ...source.extendedProperties?.shared,
                  ...fields.shared,
                },
              },
            },
          },
        );
        details.set(key(id, calendar.id, source.id), {
          at: Date.now(),
          raw: result,
        });
        if (!result.recurrence?.length)
          cache.remember(id, [normalizeEvent(result, calendar, id)], {
            local: true,
          });
        if (differs(id, result, calendar.id)) enqueue(id, calendar, [result]);
        errors.delete(id);
        break;
      }
    } catch (error) {
      // A failed job is rediscovered on the next scan/load. Do not overwrite a
      // newer event after an etag conflict or spin on permission/quota failures.
      const jobId = owner;
      if (jobId)
        errors.set(
          jobId,
          "Some automatic tags could not sync to Google. They will retry on the next scan.",
        );
      details.clear();
    } finally {
      running = false;
      activeOwner = null;
    }
  }
  function enqueue(id, calendar, items, remember = true) {
    if (closed || !hasRules(id)) return;
    if (remember)
      cache.remember(
        id,
        items
          .filter((raw) => raw.start && raw.end && raw.status !== "cancelled")
          .map((raw) => normalizeEvent(raw, calendar, id)),
      );
    if (!["owner", "writer"].includes(calendar.accessRole)) return;
    for (const raw of items) {
      if (queue.size >= 2000) break;
      if (
        !raw.start ||
        !raw.end ||
        raw.status === "cancelled" ||
        !differs(id, raw, calendar.id)
      )
        continue;
      queue.set(key(id, calendar.id, raw.id), { id, calendar, raw });
    }
  }
  async function scan(id, force = false) {
    if (!hasRules(id) || closed) return;
    const state = scans.get(id) || { at: 0, running: false };
    if (state.running) {
      if (force) state.again = true;
      return;
    }
    if (!force && Date.now() - state.at < 15 * 60000) return;
    state.running = true;
    state.at = Date.now();
    scans.set(id, state);
    try {
      const account = getAccount(id);
      const calendars = await list(id, "users/me/calendarList?maxResults=250");
      const rules = account.tags.filter(
        (tag) => tag.rule?.mode === "automatic",
      );
      const from = new Date(),
        to = new Date(from);
      to.setFullYear(to.getFullYear() + 1);
      // Keep future instances in the countdown cache; writes promote ordinary
      // occurrences to their master rather than manufacturing exceptions.
      const touched = new Set(account.automaticTagCalendars || []);
      for (const calendar of calendars) {
        if (closed) break;
        if (
          calendar.accessRole === "freeBusyReader" ||
          (!touched.has(calendar.id) &&
            !rules.some(
              (tag) => ruleCoversCalendar(tag.rule, calendar.id),
            ))
        )
          continue;
        touched.add(calendar.id);
        const query = new URLSearchParams({
          singleEvents: "true",
          maxResults: "2500",
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
        });
        enqueue(
          id,
          calendar,
          await list(
            id,
            `calendars/${encodeURIComponent(calendar.id)}/events?${query}`,
          ),
        );
      }
      if (
        JSON.stringify([...touched]) !==
        JSON.stringify(getAccount(id).automaticTagCalendars || [])
      )
        upsertAccount(id, { automaticTagCalendars: [...touched] });
    } catch {
      errors.set(
        id,
        "Automatic tag scan could not finish. Saved tags remain available; the next scan will retry.",
      );
    } finally {
      state.running = false;
      if (state.again) {
        state.again = false;
        void scan(id, true);
      }
    }
  }
  function changed(id) {
    for (const [key, job] of queue) if (job.id === id) queue.delete(key);
    errors.delete(id);
    const prior = cache.events(id);
    const touched = [
      ...new Set([
        ...(getAccount(id).automaticTagCalendars || []),
        ...prior.map((event) => event.calendarId),
      ]),
    ];
    upsertAccount(id, { automaticTagCalendars: touched });
    const events = prior.map((event) => effective(id, event));
    cache.remember(id, events, { local: true });
    details.clear();
    void scan(id, true);
  }
  const timer = setInterval(() => {
    void work();
  }, 1000);
  timer.unref();
  return {
    enqueue,
    scan,
    changed,
    effective,
    status: (id) => ({
      pending:
        [...queue.values()].filter((job) => job.id === id).length +
        (activeOwner === id ? 1 : 0),
      scanning: !!scans.get(id)?.running,
      error: errors.get(id) || null,
    }),
    close: () => {
      closed = true;
      clearInterval(timer);
      queue.clear();
    },
  };
}
