import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Client } from "google-auth-library";

test("plugin API scopes credentials and writes to their owner, authenticates hooks, and activates without duplicate events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hypercal-plugin-api-"));
  const worker = createServer((req, res) => {
    assert.ok(req.headers.authorization?.startsWith("Bearer "));
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
    });
    req.on("end", () => {
      const body = JSON.parse(text);
      assert.equal(body.accountEmail, "alice@example.test");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          items: [
            {
              id: "a",
              kind: "exam",
              title: "Exam",
              subject: "Math",
              date: "2026-11-03",
              url: "https://smnd.edupage.org/user/",
            },
          ],
          subjects: ["Math"],
        }),
      );
    });
  });
  await new Promise((resolve) => worker.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATA_DIR: directory,
    PORT: "0",
    HOST: "127.0.0.1",
    APP_URL: "http://127.0.0.1",
    COOKIE_SECURE: "false",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
    GOOGLE_CREDENTIALS_FILE: "",
    BROWSER_WORKER_TOKEN_FILE: join(directory, "isolated-worker-token"),
    BROWSER_WORKER_URL: `http://127.0.0.1:${worker.address().port}`,
    EDUPAGE_OWNER_EMAIL: "alice@example.test",
    EDUPAGE_USERNAME: "test-user-not-a-real-secret",
    EDUPAGE_PASSWORD: "test-password-not-a-real-secret",
    EDUPAGE_SCHOOL_URL: "https://smnd.edupage.org",
  });
  await writeFile(
    join(directory, "accounts.json"),
    JSON.stringify({
      accounts: Object.fromEntries(
        ["alice", "bob"].map((id) => [
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
  const writes = [];
  OAuth2Client.prototype.request = async function (options) {
    const path = new URL(options.url).pathname;
    if (path.endsWith("/calendarList"))
      return { data: { items: [{ id: "chosen", accessRole: "owner" }] } };
    assert.equal(this.credentials.access_token, "alice");
    assert.equal(path, "/calendar/v3/calendars/chosen/events");
    assert.equal(options.method, "POST");
    writes.push(options.data);
    return { data: options.data };
  };
  const { server } = await import("../server/index.mjs");
  assert.equal(
    (await stat(join(directory, "isolated-worker-token"))).mode & 0o777,
    0o600,
  );
  if (!server.listening)
    await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function login(id) {
    const response = await fetch(origin + "/api/session");
    const data = await response.json();
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const sid = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))
      .slice(2)
      .split(".")[0];
    const file = join(directory, "sessions", sid + ".json");
    const session = JSON.parse(await readFile(file, "utf8"));
    session.accountId = id;
    await writeFile(file, JSON.stringify(session));
    return {
      Cookie: cookie,
      "X-CSRF-Token": data.csrf,
      "Content-Type": "application/json",
    };
  }
  const request = (path, headers, method = "GET", body) =>
    fetch(origin + path, {
      headers,
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const alice = await login("alice"),
      bob = await login("bob");
    assert.equal((await request("/api/plugins", undefined)).status, 401);
    const listing = await (await request("/api/plugins", alice)).json();
    assert.equal(listing.environmentLoginAvailable, true);
    assert.equal(
      (await (await request("/api/plugins", bob)).json())
        .environmentLoginAvailable,
      false,
    );
    const config = {
      type: "edupage",
      schoolUrl: "https://smnd.edupage.org",
      calendarId: "chosen",
      enabled: true,
    };
    const created = await request("/api/plugins", alice, "POST", config);
    assert.equal(created.status, 201);
    const instance = await created.json();
    assert.equal(instance.trigger, "open");
    assert.equal(
      (await request(`/api/plugins/${instance.id}`, bob, "PATCH", config))
        .status,
      404,
    );
    assert.equal(
      (await (await request("/api/plugins", bob)).json()).instances.length,
      0,
    );
    for (let i = 0; i < 50; i++) {
      const state = await (await request("/api/plugins", alice)).json();
      if (state.instances[0].status === "success") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(writes.length, 1);
    const activate = await (
      await request("/api/plugins/activate", alice, "POST", {})
    ).json();
    assert.equal(activate.queued, 0);
    assert.equal(
      (await request(`/hooks/plugins/${instance.id}`, undefined, "POST"))
        .status,
      401,
    );
    const webhook = await (
      await request(`/api/plugins/${instance.id}/webhook`, alice, "POST", {})
    ).json();
    assert.ok(webhook.token.length >= 40);
    assert.equal(
      (
        await request(
          `/hooks/plugins/${instance.id}`,
          { Authorization: "Bearer " + webhook.token },
          "POST",
        )
      ).status,
      202,
    );
    const safe = JSON.stringify(
      await (await request("/api/plugins", alice)).json(),
    );
    for (const value of [
      webhook.token,
      process.env.EDUPAGE_USERNAME,
      process.env.EDUPAGE_PASSWORD,
      "webhookHash",
      '"sources"',
    ])
      assert.ok(!safe.includes(value));
    await request(`/api/plugins/${instance.id}`, alice, "DELETE");
    assert.equal(
      (await (await request("/api/plugins", alice)).json()).instances.length,
      0,
    );
    assert.equal(
      (
        await request(
          `/hooks/plugins/${instance.id}`,
          { Authorization: "Bearer " + webhook.token },
          "POST",
        )
      ).status,
      401,
    );
    assert.equal(
      (await request(`/api/plugins/${instance.id}/restore`, alice, "POST", {}))
        .status,
      200,
    );
    assert.equal(writes.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => worker.close(resolve));
    OAuth2Client.prototype.request = original;
    await rm(directory, { recursive: true, force: true });
  }
});
