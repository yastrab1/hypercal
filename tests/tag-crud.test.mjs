import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Client } from "google-auth-library";
import { tagKey } from "../server/tags.mjs";
import { applyTagAliases } from "../server/tag-aliases.mjs";
test("tag rename/delete update provider metadata, cached assignments and per-view tracking without deleting events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hypercal-tag-crud-"));
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
  const event = {
    id: "event",
    etag: "v1",
    summary: "Keep me",
    start: { date: "2027-01-20" },
    end: { date: "2027-01-21" },
    extendedProperties: {
      private: { unrelated: "keep" },
      shared: { hypercalTags: '["Exam"]', [tagKey("Exam")]: "1" },
    },
  };
  await writeFile(
    join(dir, "accounts.json"),
    JSON.stringify({
      accounts: {
        alice: {
          email: "alice@example.test",
          tokens: {
            access_token: "test-token",
            expiry_date: Date.now() + 3600000,
          },
          views: [],
          subscriptions: [],
          tags: [
            { name: "Exam", color: "#4b99d2" },
            { name: "Other", color: "#55b080" },
          ],
          tagTracking: { "layout:month": "Exam", "layout:week": "Other" },
        },
        bob: {
          email: "bob@example.test",
          tokens: {
            access_token: "bob-token",
            expiry_date: Date.now() + 3600000,
          },
          views: [],
          subscriptions: [],
          tags: [],
        },
      },
    }),
  );
  const previous = OAuth2Client.prototype.request;
  const calls = [];
  OAuth2Client.prototype.request = async function (options) {
    calls.push(options);
    const path = new URL(options.url).pathname;
    if (path.endsWith("/users/me/calendarList"))
      return { data: { items: [{ id: "primary", accessRole: "owner" }] } };
    if (options.method === "PATCH") {
      assert(options.data.extendedProperties);
      event.extendedProperties.shared = {
        ...event.extendedProperties.shared,
        ...options.data.extendedProperties.shared,
      };
      event.etag += "x";
      return { data: structuredClone(event) };
    }
    if (path.endsWith("/events/event")) return { data: structuredClone(event) };
    if (path.endsWith("/events"))
      return { data: { items: [structuredClone(event)] } };
    throw new Error("Unexpected " + path);
  };
  const { server } = await import("../server/index.mjs");
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function login(id) {
    const r = await fetch(origin + "/api/session"),
      s = await r.json(),
      cookie = r.headers.get("set-cookie").split(";")[0],
      sid = decodeURIComponent(cookie.split("=")[1]).slice(2).split(".")[0],
      file = join(dir, "sessions", sid + ".json"),
      data = JSON.parse(await readFile(file, "utf8"));
    data.accountId = id;
    await writeFile(file, JSON.stringify(data));
    return {
      Cookie: cookie,
      "X-CSRF-Token": s.csrf,
      "Content-Type": "application/json",
    };
  }
  try {
    const headers = await login("alice"),
      bob = await login("bob");
    async function change(name, body, method = "PATCH", h = headers) {
      const r = await fetch(origin + "/api/tags/" + encodeURIComponent(name), {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    }
    assert.equal(
      (await change("Exam", { name: "Other", color: "#4b99d2" })).status,
      409,
    );
    assert.equal(
      (await change("Exam", { name: "Bob", color: "#4b99d2" }, "PATCH", bob))
        .status,
      404,
    );
    const renamed = await change("Exam", {
      name: "Final exam",
      color: "#a479b1",
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.tracking["layout:month"], "Final exam");
    assert.equal(renamed.data.tracking["layout:week"], "Other");
    async function wait() {
      for (let i = 0; i < 100; i++) {
        const s = await (
          await fetch(origin + "/api/tag-sync", { headers })
        ).json();
        if (!s.pending) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("Tag sync did not finish");
    }
    await wait();
    assert.deepEqual(JSON.parse(event.extendedProperties.shared.hypercalTags), [
      "Final exam",
    ]);
    assert.equal(event.extendedProperties.private.unrelated, "keep");
    assert.equal(event.extendedProperties.shared[tagKey("Exam")], "0");
    const removed = await change("Final exam", null, "DELETE");
    assert.equal(removed.status, 200);
    assert.equal(removed.data.tracking["layout:month"], null);
    await wait();
    assert.equal(event.extendedProperties.shared.hypercalTags, "[]");
    assert(!calls.some((c) => c.method === "DELETE"));
    assert.equal(event.summary, "Keep me");
    const saved = JSON.parse(await readFile(join(dir, "accounts.json"), "utf8"))
      .accounts.alice;
    assert.deepEqual(saved.tags, [{ name: "Other", color: "#55b080" }]);
    assert.equal(saved.tagAliases.Exam, null);
    assert.equal(saved.tagJobs.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
    OAuth2Client.prototype.request = previous;
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 30,
    });
  }
});
test("retired aliases collapse chains and hide deleted assignments", () => {
  assert.deepEqual(
    applyTagAliases(["Old", "New", "Keep"], { Old: "New", New: null }),
    ["Keep"],
  );
});
