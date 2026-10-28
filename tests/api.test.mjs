import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("API isolates unauthenticated accounts and rejects forged writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hypercal-test-"));
  const port = 39731;
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      APP_URL: origin,
      ALLOWED_ORIGINS: "https://legacy.hypercal.example",
      DATA_DIR: dir,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_CREDENTIALS_FILE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await Promise.race([
      once(server.stdout, "data"),
      once(server, "exit").then(() => {
        throw new Error("Server failed to start");
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Startup timed out")), 7000).unref(),
      ),
    ]);
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("set-cookie"), null);
    const s = await fetch(`${origin}/api/session`);
    const data = await s.json();
    const cookie = s.headers.get("set-cookie").split(";")[0];
    assert.equal(data.connected, false);
    assert.equal(data.configured, false);
    assert(data.csrf);
    const calendars = await fetch(`${origin}/api/calendars`, {
      headers: { Cookie: cookie },
    });
    assert.equal(calendars.status, 401);
    const missing = await fetch(`${origin}/api/views`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(missing.status, 403);
    const forged = await fetch(`${origin}/api/views`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CSRF-Token": data.csrf,
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(forged.status, 403);
    const unauthed = await fetch(`${origin}/api/views`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CSRF-Token": data.csrf,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(unauthed.status, 401);
    const legacy = await fetch(`${origin}/api/views`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CSRF-Token": data.csrf,
        Origin: "https://legacy.hypercal.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(legacy.status, 401); // Explicit legacy origin passes CSRF, still requires authentication.
    const legacyForged = await fetch(`${origin}/api/views`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://legacy.hypercal.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(legacyForged.status, 403); // Allowlisting never replaces the CSRF token.

    const badState = await fetch(
      `${origin}/auth/google/callback?code=invalid&state=forged`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(badState.status, 400);
    const native = await fetch(`${origin}/api/native-auth/start`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-CSRF-Token": data.csrf,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(native.status, 400);
    const second = await (await fetch(`${origin}/api/session`)).json();
    assert.notEqual(second.csrf, data.csrf);
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit");
    await rm(dir, { recursive: true, force: true });
  }
});
