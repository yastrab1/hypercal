import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Client } from "google-auth-library";

test("Google adapter writes upstream, reads upstream changes, checks conflicts and isolates private views", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hypercal-google-"));
  Object.assign(process.env, {
    PORT: "0",
    HOST: "127.0.0.1",
    APP_URL: "http://127.0.0.1",
    DATA_DIR: dir,
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_CREDENTIALS_FILE: "",
    COOKIE_SECURE: "false",
  });
  const accounts = {
    accounts: {
      alice: {
        email: "alice@example.test",
        tokens: {
          access_token: "offline-test-token",
          expiry_date: Date.now() + 3600000,
        },
        views: [],
        subscriptions: [],
      },
      bob: {
        email: "bob@example.test",
        tokens: {
          access_token: "second-offline-token",
          expiry_date: Date.now() + 3600000,
        },
        views: [],
        subscriptions: [],
      },
    },
  };
  await writeFile(join(dir, "accounts.json"), JSON.stringify(accounts));
  const upstream = [];
  const copies = [];
  let rejectPatch = false;
  const originalRequest = OAuth2Client.prototype.request;
  // Exercise the entire HTTP API while replacing only the external provider boundary.
  OAuth2Client.prototype.request = async function (options) {
    assert.equal(this.credentials.access_token, "offline-test-token");
    const path = new URL(options.url).pathname;
    const method = options.method;
    const body = options.data;
    if (["POST", "PATCH"].includes(method) && body?.colorId === null)
      throw Object.assign(new Error("Required"), { status: 400 });
    if (path === "/calendar/v3/calendars" && method === "POST") {
      assert.equal(body.summary, "Created without a URL");
      return { data: { id: "created-calendar", summary: body.summary } };
    }
    if (new URL(options.url).searchParams.has("sharedExtendedProperty")) {
      assert.match(
        new URL(options.url).searchParams.get("sharedExtendedProperty"),
        /^hct_[a-f0-9]{32}=1$/,
      );
      return {
        data: {
          items:
            path === "/calendar/v3/calendars/primary/events"
              ? upstream.map((e) => ({
                  ...e,
                  start: { date: "2027-01-20" },
                  end: { date: "2027-01-21" },
                }))
              : [],
        },
      };
    }
    if (path === "/calendar/v3/users/me/calendarList")
      return {
        data: {
          items: [
            {
              id: "primary",
              summary: "Alice",
              backgroundColor: "#039be5",
              accessRole: "owner",
              primary: true,
            },
            { id: "target", summary: "Projects", accessRole: "writer" },
            { id: "readonly", summary: "Holidays", accessRole: "reader" },
          ],
        },
      };
    if (path === "/calendar/v3/calendars/primary/events" && method === "GET")
      return { data: { items: structuredClone(upstream) } };
    if (path === "/calendar/v3/calendars/primary/events" && method === "POST") {
      const event = { ...body, id: "event1", etag: '"v1"' };
      upstream.push(event);
      return { data: structuredClone(event) };
    }
    if (
      path === "/calendar/v3/calendars/primary/events/event1" &&
      method === "GET"
    )
      return { data: structuredClone(upstream[0]) };
    if (path === "/calendar/v3/calendars/target/events" && method === "POST") {
      copies.push(structuredClone(body));
      return { data: { ...body, id: "copy1", etag: '"copy-v1"' } };
    }
    if (
      path === "/calendar/v3/calendars/primary/events/event1" &&
      method === "PATCH"
    ) {
      assert.equal(options.headers["If-Match"], '"v1"');
      if (rejectPatch)
        throw Object.assign(new Error("Precondition failed"), { status: 412 });
      Object.assign(upstream[0], body, { etag: '"v2"' });
      return { data: structuredClone(upstream[0]) };
    }
    if (
      path === "/calendar/v3/calendars/primary/events/event1" &&
      method === "DELETE"
    ) {
      assert.equal(options.headers["If-Match"], '"v2"');
      upstream.length = 0;
      return { data: null };
    }
    throw new Error("Unexpected provider call: " + method + " " + path);
  };
  const { server } = await import("../server/index.mjs");
  if (!server.listening)
    await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function loginAs(id) {
    const res = await fetch(`${origin}/api/session`);
    const data = await res.json();
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const sid = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))
      .slice(2)
      .split(".")[0];
    const file = join(dir, "sessions", sid + ".json");
    const s = JSON.parse(await readFile(file, "utf8"));
    s.accountId = id;
    await writeFile(file, JSON.stringify(s));
    return {
      Cookie: cookie,
      "X-CSRF-Token": data.csrf,
      "Content-Type": "application/json",
    };
  }
  try {
    const alice = await loginAs("alice");
    const bob = await loginAs("bob");
    const preferences = await fetch(`${origin}/api/preferences`, {
      method: "PATCH",
      headers: alice,
      body: JSON.stringify({ notificationDefault: "120" }),
    });
    assert.equal(preferences.status, 200);
    assert.deepEqual(await preferences.json(), { notificationDefault: "120" });
    const aliceSession = await (
      await fetch(`${origin}/api/session`, { headers: alice })
    ).json();
    const bobSession = await (
      await fetch(`${origin}/api/session`, { headers: bob })
    ).json();
    assert.equal(aliceSession.notificationDefault, "120");
    assert.equal(bobSession.notificationDefault, "calendar");
    const invalidPreference = await fetch(`${origin}/api/preferences`, {
      method: "PATCH",
      headers: alice,
      body: JSON.stringify({ notificationDefault: "40321" }),
    });
    assert.equal(invalidPreference.status, 400);
    await invalidPreference.json();
    const cs = await (
      await fetch(`${origin}/api/calendars`, { headers: alice })
    ).json();
    assert.equal(cs[0].name, "Alice");
    assert.equal(cs[0].readOnly, false);
    const newCalendar = await fetch(`${origin}/api/calendars`, {
      method: "POST",
      headers: alice,
      body: JSON.stringify({ name: "Created without a URL" }),
    });
    assert.equal(newCalendar.status, 201);
    assert.equal((await newCalendar.json()).source, "google");
    const tagDefinitions = [
      { name: "Exam", color: "#a479b1" },
      { name: "Holiday", color: "#55b080" },
    ];
    const tagSaved = await fetch(`${origin}/api/tags`, {
      method: "PUT",
      headers: alice,
      body: JSON.stringify(tagDefinitions),
    });
    assert.equal(tagSaved.status, 200);
    assert.deepEqual(
      await (await fetch(`${origin}/api/tags`, { headers: alice })).json(),
      tagDefinitions,
    );
    assert.deepEqual(
      await (await fetch(`${origin}/api/tags`, { headers: bob })).json(),
      [],
    );
    async function track(viewKey, tagName, headers = alice) {
      return fetch(`${origin}/api/tag-tracking`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ viewKey, tagName }),
      });
    }
    assert.equal((await track("layout:month", "Exam")).status, 200);
    assert.equal((await track("layout:week", "Holiday")).status, 200);
    assert.deepEqual(
      await (
        await fetch(`${origin}/api/tag-tracking`, { headers: alice })
      ).json(),
      { "layout:month": "Exam", "layout:week": "Holiday" },
    );
    assert.deepEqual(
      await (
        await fetch(`${origin}/api/tag-tracking`, { headers: bob })
      ).json(),
      {},
    );
    assert.equal((await track("view:someone-elses-view", "Exam")).status, 400);
    assert.equal((await track("layout:month", "Missing")).status, 400);
    assert.equal((await track("layout:month", "Holiday")).status, 200);
    assert.deepEqual(
      await (
        await fetch(`${origin}/api/tag-tracking`, { headers: alice })
      ).json(),
      { "layout:month": "Holiday", "layout:week": "Holiday" },
    );
    assert.equal((await track("layout:month", "Exam")).status, 200);
    const duplicateTags = await fetch(`${origin}/api/tags`, {
      method: "PUT",
      headers: alice,
      body: JSON.stringify([...tagDefinitions, ...tagDefinitions]),
    });
    assert.equal(duplicateTags.status, 400);
    await duplicateTags.json();
    const draft = {
      calendarId: "primary",
      tags: ["Exam"],
      title: "HyperCal writes upstream",
      description: "",
      location: "Room B",
      start: "2027-01-20T10:00:00Z",
      end: "2027-01-20T11:00:00Z",
      allDay: false,
      timeZone: "Europe/Bratislava",
      reminderMinutes: 120,
      color: "#18ab72",
    };
    const created = await fetch(`${origin}/api/events`, {
      method: "POST",
      headers: alice,
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(created.status, 201);
    await created.json();
    assert.equal(upstream[0].summary, draft.title);
    assert.deepEqual(
      JSON.parse(upstream[0].extendedProperties.shared.hypercalTags),
      ["Exam"],
    );
    let countdowns;
    for (let i = 0; i < 100; i++) {
      countdowns = await (
        await fetch(`${origin}/api/tag-countdowns`, { headers: alice })
      ).json();
      if (!countdowns.refreshing) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(countdowns.refreshing, false);
    assert.match(countdowns.next.Exam.start, /^2027-01-20/);
    assert.deepEqual(countdowns.warnings, []);
    assert.equal(
      upstream[0].extendedProperties.private.hypercalColor,
      draft.color,
    );
    assert.equal(upstream[0].start.timeZone, "Europe/Bratislava");
    assert.deepEqual(upstream[0].reminders, {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 120 }],
    });
    const q = new URLSearchParams({
      from: "2026-10-28T00:00:00Z",
      to: "2026-10-29T00:00:00Z",
      calendars: '["primary"]',
    });
    upstream[0].summary = "Changed from Google Calendar";
    const fromGoogle = await (
      await fetch(`${origin}/api/events?${q}`, { headers: alice })
    ).json();
    assert.equal(fromGoogle.events[0].title, "Changed from Google Calendar");
    assert.equal(fromGoogle.events[0].color, draft.color);
    assert.deepEqual(fromGoogle.events[0].tags, ["Exam"]);
    assert.equal(fromGoogle.events[0].etag, '"v1"');
    upstream[0].recurringEventId = "series1";
    upstream[0].attendees = [{ email: "friend@example.test" }];
    async function copyTo(destinationCalendarId, etag = '"v1"') {
      return fetch(`${origin}/api/events/event1/copy`, {
        method: "POST",
        headers: alice,
        body: JSON.stringify({
          calendarId: "primary",
          destinationCalendarId,
          etag,
        }),
      });
    }
    const copy = await copyTo("target");
    assert.equal(copy.status, 201);
    const copied = await copy.json();
    assert.equal(copied.calendarId, "target");
    assert.equal(copied.id, "copy1");
    assert.equal(copied.color, draft.color);
    assert.equal(copied.title, "Changed from Google Calendar");
    assert.equal(copies[0].attendees, undefined);
    assert.equal(copies[0].extendedProperties.shared.hypercalTags, '["Exam"]');
    assert.equal(copies[0].recurringEventId, undefined);
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0].id, "event1");
    for (const [destination, etag, status] of [
      ["primary", '\"v1\"', 400],
      ["readonly", '\"v1\"', 403],
      ["missing", '\"v1\"', 403],
      ["target", '\"stale\"', 412],
    ]) {
      const rejected = await copyTo(destination, etag);
      assert.equal(rejected.status, status);
      await rejected.json();
    }
    assert.equal(copies.length, 1);
    rejectPatch = true;
    const conflict = await fetch(`${origin}/api/events/event1`, {
      method: "PATCH",
      headers: alice,
      body: JSON.stringify({ ...draft, etag: '"v1"' }),
    });
    assert.equal(conflict.status, 412);
    assert.match((await conflict.json()).error, /changed in Google Calendar/);
    rejectPatch = false;
    const edited = await fetch(`${origin}/api/events/event1`, {
      method: "PATCH",
      headers: alice,
      body: JSON.stringify({
        ...draft,
        title: "Edited in HyperCal",
        tags: [],
        useDefaultReminders: true,
        color: null,
        etag: '"v1"',
      }),
    });
    assert.equal(edited.status, 200);
    await edited.json();
    assert.equal(upstream[0].summary, "Edited in HyperCal");
    assert.equal(upstream[0].colorId, "0");
    assert.equal(upstream[0].extendedProperties.shared.hypercalTags, "[]");
    assert(
      Object.entries(upstream[0].extendedProperties.shared).some(
        ([key, value]) => key.startsWith("hct_") && value === "0",
      ),
    );
    assert.equal(
      upstream[0].extendedProperties.private.hypercalColor,
      "default",
    );
    assert.deepEqual(upstream[0].reminders, { useDefault: true });
    const view = await fetch(`${origin}/api/views`, {
      method: "POST",
      headers: alice,
      body: JSON.stringify({
        name: "Private school view",
        layout: "day",
        calendarIds: ["primary"],
        include: "exam",
        exclude: "lecture",
        hideAllDay: false,
      }),
    });
    assert.equal(view.status, 201);
    assert.equal((await view.json()).visibility, "private");
    const define = {
      name: "School default",
      layout: "day",
      calendarIds: ["primary"],
      include: "",
      exclude: "",
      hideAllDay: false,
      isDefault: true,
    };
    const firstDefault = await (
      await fetch(`${origin}/api/views`, {
        method: "POST",
        headers: alice,
        body: JSON.stringify(define),
      })
    ).json();
    const secondDefault = await (
      await fetch(`${origin}/api/views`, {
        method: "POST",
        headers: alice,
        body: JSON.stringify({ ...define, name: "Personal default" }),
      })
    ).json();
    let defaults = await (
      await fetch(`${origin}/api/views`, { headers: alice })
    ).json();
    assert.equal(
      defaults.filter((v) => v.layout === "day" && v.isDefault).length,
      1,
    );
    assert.equal(defaults.find((v) => v.isDefault).id, secondDefault.id);
    const wrongLayout = await fetch(`${origin}/api/view-defaults/month`, {
      method: "PATCH",
      headers: alice,
      body: JSON.stringify({ viewId: firstDefault.id }),
    });
    assert.equal(wrongLayout.status, 400);
    await wrongLayout.json();
    const changed = await fetch(`${origin}/api/view-defaults/day`, {
      method: "PATCH",
      headers: alice,
      body: JSON.stringify({ viewId: firstDefault.id }),
    });
    assert.equal(changed.status, 200);
    defaults = await changed.json();
    assert.equal(defaults.find((v) => v.isDefault).id, firstDefault.id);
    const forbiddenDefault = await fetch(`${origin}/api/view-defaults/day`, {
      method: "PATCH",
      headers: bob,
      body: JSON.stringify({ viewId: firstDefault.id }),
    });
    assert.equal(forbiddenDefault.status, 400);
    await forbiddenDefault.json();
    const bobsViews = await (
      await fetch(`${origin}/api/views`, { headers: bob })
    ).json();
    assert.deepEqual(bobsViews, []);
    const deleted = await fetch(`${origin}/api/events/event1`, {
      method: "DELETE",
      headers: alice,
      body: JSON.stringify({ calendarId: "primary", etag: '"v2"' }),
    });
    assert.equal(deleted.status, 200);
    await deleted.json();
    assert.equal(upstream.length, 0);
  } finally {
    OAuth2Client.prototype.request = originalRequest;
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 30,
    });
  }
});
