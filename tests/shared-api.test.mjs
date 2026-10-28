import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Client } from "google-auth-library";

test("shared API enforces identities, contributions, member removal and independent public link revocation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hypercal-sharing-"));
  Object.assign(process.env, {
    PORT: "0",
    HOST: "127.0.0.1",
    APP_URL: "http://127.0.0.1",
    DATA_DIR: dir,
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
    GOOGLE_CREDENTIALS_FILE: "",
    COOKIE_SECURE: "false",
  });
  await writeFile(
    join(dir, "accounts.json"),
    JSON.stringify({
      accounts: Object.fromEntries(
        ["alice", "bob", "carol"].map((id) => [
          id,
          {
            email: `${id}@example.test`,
            tokens: { access_token: id, expiry_date: Date.now() + 3600000 },
            views: [],
            subscriptions: [],
          },
        ]),
      ),
    }),
  );
  const original = OAuth2Client.prototype.request;
  const requests = [];
  let gate, started;
  let blocked = false;
  OAuth2Client.prototype.request = async function (options) {
    const account = this.credentials.access_token;
    requests.push(account);
    assert.ok(["alice", "bob", "carol"].includes(account));
    const url = new URL(options.url);
    if (url.pathname === "/calendar/v3/users/me/calendarList")
      return {
        data: {
          items: [
            {
              id: "primary",
              summary: "Personal",
              accessRole: "owner",
              backgroundColor: "#7986cb",
            },
          ],
        },
      };
    if (blocked && account === "alice" && url.pathname.endsWith("/events")) {
      started();
      await gate;
    }
    if (url.pathname === "/calendar/v3/calendars/primary/events")
      return {
        data: {
          items: [
            {
              id: "same-id",
              summary: `${account} event`,
              description: "private secret notes",
              location: "private location",
              start: { dateTime: "2026-10-28T10:00:00Z" },
              end: { dateTime: "2026-10-28T11:00:00Z" },
              htmlLink: "private-google-link",
              etag: "secret",
            },
          ],
        },
      };
    throw new Error("Unexpected provider request");
  };
  const { server } = await import("../server/index.mjs");
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function login(id) {
    const response = await fetch(origin + "/api/session");
    const data = await response.json();
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const sid = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))
      .slice(2)
      .split(".")[0];
    const path = join(dir, "sessions", sid + ".json");
    const session = JSON.parse(await readFile(path, "utf8"));
    session.accountId = id;
    await writeFile(path, JSON.stringify(session));
    return {
      Cookie: cookie,
      "X-CSRF-Token": data.csrf,
      "Content-Type": "application/json",
    };
  }
  async function call(path, headers, method = "GET", body, expected = 200) {
    const r = await fetch(origin + "/api" + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(r.status, expected, `${method} ${path}: ${r.status}`);
    return r.headers.get("content-type")?.includes("text/calendar")
      ? r.text()
      : r.json();
  }
  try {
    const alice = await login("alice"),
      bob = await login("bob"),
      carol = await login("carol");
    const created = await call(
      "/shared-views",
      alice,
      "POST",
      { name: "Together", layout: "month" },
      201,
    );
    const base = "/shared-views/" + created.id;
    assert.equal(created.members.length, 1);
    assert.deepEqual(created.members[0].contributions, []);
    await call(base, bob, "GET", undefined, 404);
    await call(base, bob, "PATCH", { name: "Stolen", layout: "day" }, 404);
    const invite = await call(
      base + "/invitations",
      alice,
      "POST",
      { email: "bob@example.test" },
      201,
    );
    const token = new URL(invite.url).hash.slice("#invite=".length);
    assert.deepEqual(await call("/shared-invitations/" + token, undefined), {
      name: "Together",
    });
    await call(
      "/shared-invitations/" + token + "/accept",
      carol,
      "POST",
      undefined,
      403,
    );
    await call("/shared-invitations/" + token + "/accept", bob, "POST");
    await call(
      "/shared-invitations/" + token + "/accept",
      bob,
      "POST",
      undefined,
      404,
    );
    await call(base, bob, "PATCH", { name: "Stolen", layout: "day" }, 403);
    await call(
      base + "/invitations",
      bob,
      "POST",
      { email: "carol@example.test" },
      403,
    );
    await call(base + "/links", bob, "POST", { scope: "web" }, 403);
    await call(
      base + "/contributions",
      alice,
      "PUT",
      {
        contributions: [
          { calendarId: "foreign", detail: "details", publicAllowed: true },
        ],
      },
      403,
    );
    await call(base + "/contributions", alice, "PUT", {
      contributions: [
        { calendarId: "primary", detail: "details", publicAllowed: false },
      ],
    });
    await call(base + "/contributions", bob, "PUT", {
      contributions: [
        { calendarId: "primary", detail: "busy", publicAllowed: true },
      ],
    });
    const query = "?from=2026-10-28T00:00:00Z&to=2026-10-29T00:00:00Z";
    const combined = await call(base + "/events" + query, alice);
    assert.deepEqual(combined.events.map((e) => e.title).sort(), [
      "Busy",
      "alice event",
    ]);
    assert.ok(requests.includes("alice") && requests.includes("bob"));
    assert.ok(
      combined.events.every((e) => e.readOnly && !e.etag && !e.htmlLink),
    );
    const link = await call(
      base + "/links",
      alice,
      "POST",
      { scope: "web" },
      201,
    );
    const shareToken = new URL(link.url).hash.slice("#share=".length);
    const publicPath = "/shared-links/" + shareToken;
    const publicResult = await call(publicPath + query, undefined);
    assert.equal(publicResult.events.length, 1);
    assert.equal(publicResult.events[0].title, "Busy");
    for (const privateText of [
      "alice@example",
      "bob@example",
      "private secret",
      "private location",
      "private-google-link",
    ])
      assert.ok(!JSON.stringify(publicResult).includes(privateText));
    await call(publicPath + "/calendar.ics", undefined, "GET", undefined, 404);
    const ical = await call(
      base + "/links",
      alice,
      "POST",
      { scope: "ical" },
      201,
    );
    const icalPath = new URL(ical.url).pathname.replace("/api", "");
    assert.match(await call(icalPath, undefined), /BEGIN:VCALENDAR/);
    await call(base + "/members/bob", alice, "DELETE");
    await call(base + "/events" + query, bob, "GET", undefined, 404);
    assert.deepEqual((await call(publicPath + query, undefined)).events, []);
    // Revoking a contribution while an upstream read is in flight must prevent
    // that read from serializing the previously permitted public data.
    await call(base + "/contributions", alice, "PUT", {
      contributions: [
        { calendarId: "primary", detail: "details", publicAllowed: true },
      ],
    });
    let release;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const began = new Promise((resolve) => {
      started = resolve;
    });
    blocked = true;
    const inFlight = fetch(
      origin +
        "/api" +
        publicPath +
        "?from=2026-10-27T00:00:00Z&to=2026-10-30T00:00:00Z",
    );
    await began;
    await call(base + "/contributions", alice, "PUT", {
      contributions: [
        { calendarId: "primary", detail: "details", publicAllowed: false },
      ],
    });
    blocked = false;
    release();
    const stale = await inFlight;
    assert.equal(stale.status, 409);
    await stale.json();
    const info = await call(base, alice);
    const web = info.links.find((l) => l.scope === "web");
    await call(base + "/links/" + web.id, alice, "DELETE");
    await call(publicPath + query, undefined, "GET", undefined, 404);
    assert.match(await call(icalPath, undefined), /BEGIN:VCALENDAR/);
    const pending = await call(
      base + "/invitations",
      alice,
      "POST",
      { email: "carol@example.test" },
      201,
    );
    const info2 = await call(base, alice);
    const pendingId = info2.invitations.find(
      (i) => i.email === "carol@example.test",
    ).id;
    await call(base + "/invitations/" + pendingId, alice, "DELETE");
    const carolToken = new URL(pending.url).hash.slice("#invite=".length);
    await call(
      "/shared-invitations/" + carolToken + "/accept",
      carol,
      "POST",
      undefined,
      404,
    );
    await call(base, alice, "DELETE");
    await call(icalPath, undefined, "GET", undefined, 404);
  } finally {
    OAuth2Client.prototype.request = original;
    await new Promise((r) => server.close(r));
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});
