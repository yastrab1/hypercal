import { createHash } from "node:crypto";
import { RE2 } from "re2-wasm";

export function excludePattern(value) {
  if (!value) return null;
  try {
    return new RE2(value, "iu");
  } catch {
    throw Object.assign(
      new Error(
        "Invalid exclusion regex. Use a regular expression without lookarounds or backreferences.",
      ),
      { status: 400 },
    );
  }
}
export function filteredAssignments(items, config) {
  const pattern = excludePattern(config.excludeRegex);
  const excluded = new Set(
    config.excludeSubjects.map((s) => s.trim().toLocaleLowerCase()),
  );
  return items.filter(
    (item) =>
      (item.kind === "exam" ? config.exams : config.homework) &&
      !excluded.has(item.subject.trim().toLocaleLowerCase()) &&
      !pattern?.test(
        `${item.subject}\n${item.title}\n${item.description || ""}`,
      ),
  );
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function assignmentEvent(instance, item) {
  const start = item.date;
  const endDate = new Date(start + "T12:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return {
    id:
      "hc" + digest(`${instance.owner}:${instance.id}:${item.id}`).slice(0, 48),
    summary:
      `${item.kind === "exam" ? "Exam" : "Homework"} · ${item.subject ? item.subject + " · " : ""}${item.title}`.slice(
        0,
        900,
      ),
    description: [item.description, `Source: ${item.url}`]
      .filter(Boolean)
      .join("\n\n"),
    start: { date: start },
    end: { date: endDate.toISOString().slice(0, 10) },
    extendedProperties: {
      private: { hypercalPlugin: instance.id, hypercalSourceId: item.id },
    },
  };
}

function eventPatch(body, remote) {
  const { id, ...patch } = body;
  return {
    ...patch,
    extendedProperties: {
      ...remote.extendedProperties,
      private: {
        ...remote.extendedProperties?.private,
        ...body.extendedProperties.private,
      },
    },
  };
}

// Stable provider IDs make interrupted/retried inserts idempotent. Only events
// owned by this plugin instance may be updated; unrelated events are untouched.
export async function syncAssignments(
  instance,
  items,
  { request, save, check = () => {} },
) {
  const selected = filteredAssignments(items, instance);
  let created = 0,
    updated = 0,
    unchanged = 0;
  const calendar = `calendars/${encodeURIComponent(instance.calendarId)}/events`;
  for (const item of selected) {
    check();
    const body = assignmentEvent(instance, item);
    const fingerprint = digest(JSON.stringify(body));
    const key = `${instance.calendarId}:${item.id}`;
    const existing = instance.sources[key];
    if (existing?.fingerprint === fingerprint) {
      unchanged++;
      continue;
    }
    if (!existing) {
      try {
        await request(instance.owner, calendar, { method: "POST", body });
        created++;
      } catch (error) {
        if ((error.response?.status || error.status || error.code) !== 409)
          throw error;
        const remote = await request(instance.owner, `${calendar}/${body.id}`);
        if (remote.extendedProperties?.private?.hypercalPlugin !== instance.id)
          throw new Error(
            "An existing event has a conflicting source ID. No event was overwritten.",
          );
        await request(instance.owner, `${calendar}/${body.id}`, {
          method: "PATCH",
          body: eventPatch(body, remote),
          etag: remote.etag,
        });
        updated++;
      }
    } else {
      const remote = await request(
        instance.owner,
        `${calendar}/${existing.eventId}`,
      );
      if (remote.extendedProperties?.private?.hypercalPlugin !== instance.id)
        throw new Error(
          "An imported event no longer belongs to this plugin. No event was overwritten.",
        );
      await request(instance.owner, `${calendar}/${existing.eventId}`, {
        method: "PATCH",
        body: eventPatch(body, remote),
        etag: remote.etag,
      });
      updated++;
    }
    instance.sources[key] = { eventId: body.id, fingerprint };
    save();
  }
  return {
    created,
    updated,
    unchanged,
    excluded: items.length - selected.length,
    message: `${created} added, ${updated} updated, ${unchanged} unchanged.`,
    changed: created + updated > 0,
  };
}
