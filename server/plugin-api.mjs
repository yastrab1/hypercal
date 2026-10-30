import { createHash } from "node:crypto";

// Capabilities are declared by operator-installed plugin manifests. They are
// applied to the current account and selected calendar, not caller-supplied IDs.
export function createPluginApi(
  instance,
  { request, allPages, save, check, capabilities },
) {
  const allow = (capability) => {
    check();
    if (!capabilities.includes(capability))
      throw new Error(`Plugin capability is not enabled: ${capability}`);
  };
  const calendar = `calendars/${encodeURIComponent(instance.calendarId)}`;
  const key = (sourceId) => `${instance.calendarId}:api:${sourceId}`;
  const owned = async (sourceId) => {
    const saved = instance.sources[key(sourceId)];
    if (!saved) throw new Error("This event was not created by this plugin.");
    const path = `${calendar}/events/${encodeURIComponent(saved.eventId)}`;
    const event = await request(instance.owner, path);
    if (event.extendedProperties?.private?.hypercalPlugin !== instance.id)
      throw new Error("This event no longer belongs to this plugin.");
    return { event, path };
  };
  const eventFields = (body) =>
    Object.fromEntries(
      [
        "summary",
        "description",
        "location",
        "start",
        "end",
        "reminders",
        "colorId",
        "transparency",
      ]
        .filter((k) => body[k] !== undefined)
        .map((k) => [k, body[k]]),
    );
  return {
    check,
    events: {
      list: async (from, to) => {
        allow("events.read");
        const query = new URLSearchParams({
          timeMin: from,
          timeMax: to,
          singleEvents: "true",
          maxResults: "2500",
          privateExtendedProperty: `hypercalPlugin=${instance.id}`,
        });
        return allPages(instance.owner, `${calendar}/events?${query}`);
      },
      create: async (sourceId, body) => {
        allow("events.write");
        if (!sourceId || typeof sourceId !== "string" || sourceId.length > 1000)
          throw new Error("A stable plugin source ID is required.");
        if (instance.sources[key(sourceId)])
          throw new Error(
            "This source already has an event. Update it instead.",
          );
        const id =
          "hc" +
          createHash("sha256")
            .update(`${instance.owner}:${instance.id}:api:${sourceId}`)
            .digest("hex")
            .slice(0, 48);
        let event;
        try {
          event = await request(instance.owner, `${calendar}/events`, {
            method: "POST",
            body: {
              ...eventFields(body),
              id,
              extendedProperties: {
                private: {
                  hypercalPlugin: instance.id,
                  hypercalSourceId: sourceId,
                },
              },
            },
          });
        } catch (error) {
          if ((error.response?.status || error.status || error.code) !== 409)
            throw error;
          event = await request(instance.owner, `${calendar}/events/${id}`);
          if (event.extendedProperties?.private?.hypercalPlugin !== instance.id)
            throw new Error("The source ID conflicts with another event.");
        }
        instance.sources[key(sourceId)] = { eventId: event.id };
        save();
        return event;
      },
      update: async (sourceId, body) => {
        allow("events.write");
        const { event, path } = await owned(sourceId);
        check();
        return request(instance.owner, path, {
          method: "PATCH",
          body: eventFields(body),
          etag: event.etag,
        });
      },
      remove: async (sourceId) => {
        allow("events.write");
        const { event, path } = await owned(sourceId);
        check();
        await request(instance.owner, path, {
          method: "DELETE",
          etag: event.etag,
        });
        delete instance.sources[key(sourceId)];
        save();
      },
    },
    calendars: {
      getTarget: async () => {
        allow("calendars.read");
        return request(instance.owner, calendar);
      },
      updateTarget: async (body) => {
        allow("calendars.write");
        const fields = Object.fromEntries(
          ["summary", "description", "timeZone"]
            .filter((k) => body[k] !== undefined)
            .map((k) => [k, body[k]]),
        );
        return request(instance.owner, calendar, {
          method: "PATCH",
          body: fields,
        });
      },
      create: async (body) => {
        allow("calendars.create");
        return request(instance.owner, "calendars", {
          method: "POST",
          body: {
            summary: body.summary,
            description: body.description,
            timeZone: body.timeZone,
          },
        });
      },
    },
  };
}
