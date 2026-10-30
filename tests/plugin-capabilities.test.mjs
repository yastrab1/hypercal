import test from "node:test";
import assert from "node:assert/strict";
import { createPluginApi } from "../server/plugin-api.mjs";

test("plugin capabilities pin account/calendar and prohibit editing unrelated events or calendar metadata", async () => {
  const instance = {
    owner: "alice",
    id: "plugin-a",
    calendarId: "chosen/calendar",
    sources: {},
  };
  const remote = new Map();
  const calls = [];
  const request = async (owner, path, options = {}) => {
    assert.equal(owner, "alice");
    assert.ok(path.startsWith("calendars/chosen%2Fcalendar"));
    calls.push([options.method || "GET", path, options.body]);
    if (options.method === "POST") {
      remote.set(options.body.id, { ...options.body, etag: "v1" });
      return options.body;
    }
    const id = path.split("/").at(-1);
    if (!options.method) return remote.get(id);
    assert.equal(options.etag, "v1");
    if (options.method === "DELETE") {
      remote.delete(id);
      return null;
    }
    Object.assign(remote.get(id), options.body);
    return remote.get(id);
  };
  const api = createPluginApi(instance, {
    request,
    allPages: async (owner, path) => {
      assert.equal(owner, "alice");
      assert.ok(path.includes("hypercalPlugin%3Dplugin-a"));
      return [];
    },
    save() {},
    check() {},
    capabilities: ["events.read", "events.write", "calendars.read"],
  });
  await assert.rejects(
    api.calendars.updateTarget({ summary: "Changed" }),
    /capability/,
  );
  await assert.rejects(api.calendars.create({ summary: "New" }), /capability/);
  await assert.rejects(
    api.events.update("not-owned", { summary: "No" }),
    /not created/,
  );
  const event = await api.events.create("source-a", {
    summary: "A",
    start: { date: "2026-11-03" },
    end: { date: "2026-11-04" },
    attendees: [{ email: "unrequested@example.test" }],
  });
  assert.equal(event.attendees, undefined);
  await api.events.update("source-a", { summary: "Updated" });
  assert.equal(remote.get(event.id).summary, "Updated");
  await api.events.list("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
  remote.get(event.id).extendedProperties.private.hypercalPlugin = "foreign";
  await assert.rejects(api.events.remove("source-a"), /no longer belongs/);
  remote.get(event.id).extendedProperties.private.hypercalPlugin = "plugin-a";
  await api.events.remove("source-a");
  assert.equal(remote.size, 0);
  assert.ok(
    calls.every(([, path]) => path.startsWith("calendars/chosen%2Fcalendar/")),
  );
});
