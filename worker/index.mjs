import express from "express";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { schoolOrigin, dashboardData, assignmentsFrom } from "./edupage.mjs";

const root = process.env.PROFILE_DIR || "/profiles";
await mkdir(root, { recursive: true, mode: 0o700 });
const token = (
  await readFile(
    process.env.WORKER_TOKEN_FILE || "/run/secrets/browser-token",
    "utf8",
  )
).trim();
if (token.length < 40) throw new Error("A private worker token is required.");
const app = express();
app.use(express.json({ limit: "20kb" }));
app.get("/health", (req, res) => res.json({ ok: true }));
app.use((req, res, next) => {
  const supplied = String(req.headers.authorization || "").replace(
    /^Bearer /,
    "",
  );
  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
  )
    return res.sendStatus(401);
  next();
});
let browser;
const sessions = new Map();
const locks = new Map();
async function exclusive(key, operation) {
  const prior = locks.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(operation);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
async function persist(key, session) {
  const file = join(root, key + ".json");
  const state = await session.context.storageState({ indexedDB: true });
  await writeFile(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
  await rename(file + ".tmp", file);
  await chmod(file, 0o600);
}
async function open(key, school) {
  const origin = schoolOrigin(school);
  const current = sessions.get(key);
  if (current) {
    if (current.origin !== origin) {
      await current.context.close();
      sessions.delete(key);
    } else {
      current.used = Date.now();
      return current;
    }
  }
  if (!browser?.isConnected())
    browser = await chromium.launch({
      chromiumSandbox: process.env.BROWSER_SANDBOX !== "0",
    });
  if (sessions.size >= 3) {
    const [oldKey, old] = [...sessions].sort(
      (a, b) => a[1].used - b[1].used,
    )[0];
    await persist(oldKey, old);
    await old.context.close();
    sessions.delete(oldKey);
  }
  let storageState;
  try {
    storageState = JSON.parse(
      await readFile(join(root, key + ".json"), "utf8"),
    );
  } catch {}
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1000, height: 800 },
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.protocol === "https:" &&
      (url.hostname === "edupage.org" || url.hostname.endsWith(".edupage.org"))
      ? route.continue()
      : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("dialog", (dialog) => dialog.dismiss());
  const session = {
    context,
    page,
    origin,
    used: Date.now(),
    interactive: false,
  };
  sessions.set(key, session);
  await page.goto(origin + "/user/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  return session;
}
async function snapshot(session) {
  return {
    image:
      "data:image/jpeg;base64," +
      (await session.page.screenshot({ type: "jpeg", quality: 75 })).toString(
        "base64",
      ),
    width: 1000,
    height: 800,
    title: (await session.page.title()).slice(0, 150),
    location: new URL(session.page.url()).origin,
  };
}
async function environmentSignIn(session) {
  if (
    !process.env.EDUPAGE_USERNAME ||
    !process.env.EDUPAGE_PASSWORD ||
    session.accountEmail?.toLowerCase() !==
      process.env.EDUPAGE_OWNER_EMAIL?.toLowerCase() ||
    session.origin !==
      schoolOrigin(process.env.EDUPAGE_SCHOOL_URL || "https://smnd.edupage.org")
  )
    return false;
  const page = session.page;
  const remember = page.getByRole("button", {
    name: "Nič neukladať a viac sa nepýtať",
    exact: true,
  });
  const continueWithoutSaving = async () => {
    if (!(await remember.isVisible())) return false;
    for (const name of ["remember_usr", "remember_pwd"])
      await page.locator(`input[name="${name}"]`).uncheck();
    await remember.click();
    await page.waitForURL((url) => url.pathname.startsWith("/user"), {
      timeout: 20000,
    });
    return true;
  };
  const cookieNotice = page.getByRole("button", { name: "Ok", exact: true });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  if (await continueWithoutSaving()) return true;
  const loginLink = page.locator('a[href*="cmd=MainLogin"]');
  if (await loginLink.count()) await loginLink.first().click();
  try {
    const username = page.locator('input[name="username"]:visible').first();
    await username.waitFor({ state: "visible", timeout: 12000 });
    await username.fill(process.env.EDUPAGE_USERNAME);
    await username.press("Enter");
    const password = page.locator('input[type="password"]:visible').first();
    await password.waitFor({ state: "visible", timeout: 15000 });
    await password.fill(process.env.EDUPAGE_PASSWORD);
    await password.press("Enter");
    await Promise.race([
      page.waitForURL((url) => url.pathname.startsWith("/user"), {
        timeout: 20000,
      }),
      remember.waitFor({ state: "visible", timeout: 20000 }),
    ]);
    if (!(await continueWithoutSaving()))
      await page.waitForURL((url) => url.pathname.startsWith("/user"), {
        timeout: 20000,
      });
    return true;
  } catch {
    throw Object.assign(
      new Error(
        "EduPage needs an additional sign-in step or the server credentials were not accepted. Open the connection screen to finish.",
      ),
      { code: "EDUPAGE_LOGIN" },
    );
  }
}
async function collect(key, session) {
  await session.page.goto(session.origin + "/user/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  const scripts = await session.page.locator("script").allTextContents();
  let data = dashboardData(scripts);
  if (!data && (await environmentSignIn(session)))
    data = dashboardData(
      await session.page.locator("script").allTextContents(),
    );
  if (!data)
    throw Object.assign(
      new Error("Sign in to EduPage in the connection screen, then try again."),
      { code: "EDUPAGE_LOGIN" },
    );
  // The browser session supplies cookies; no EduPage password is stored by HyperCal.
  const year =
    new Date().getMonth() < 7
      ? new Date().getFullYear() - 1
      : new Date().getFullYear();
  const query = new URLSearchParams({ datefrom: `${year}-08-01` }).toString();
  const response = await session.context.request.post(
    session.origin + "/timeline/?akcia=getData",
    {
      form: { eqap: Buffer.from(query).toString("base64"), eqaz: "0" },
      timeout: 25000,
    },
  );
  if (!response.ok())
    throw new Error(
      "EduPage could not refresh assignments. Existing imported events were kept.",
    );
  let timeline;
  try {
    timeline = await response.json();
  } catch {
    throw Object.assign(
      new Error("Your EduPage session expired. Reconnect to continue."),
      { code: "EDUPAGE_LOGIN" },
    );
  }
  if (Array.isArray(timeline.homeworks))
    data.homeworks = [...(data.homeworks || []), ...timeline.homeworks];
  const result = assignmentsFrom(data, session.origin);
  await persist(key, session);
  return result;
}
app.post("/:key/:action", async (req, res) => {
  if (!/^[a-f0-9]{64}$/.test(req.params.key)) return res.sendStatus(400);
  const { key, action } = req.params;
  const result = await exclusive(key, async () => {
    const session = await open(key, req.body.schoolUrl);
    session.used = Date.now();
    session.accountEmail = req.body.accountEmail;
    if (action === "open") {
      session.interactive = true;
      return snapshot(session);
    }
    if (action === "snapshot") return snapshot(session);
    if (action === "input") {
      if (!session.interactive)
        throw new Error("Open the connection screen first.");
      const input = req.body.input;
      if (
        input?.type === "click" &&
        Number.isFinite(input.x) &&
        Number.isFinite(input.y) &&
        input.x >= 0 &&
        input.x <= 1000 &&
        input.y >= 0 &&
        input.y <= 800
      )
        await session.page.mouse.click(input.x, input.y);
      else if (
        input?.type === "text" &&
        typeof input.text === "string" &&
        input.text.length <= 2000
      )
        await session.page.keyboard.insertText(input.text);
      else if (
        input?.type === "key" &&
        [
          "Tab",
          "Enter",
          "Backspace",
          "Escape",
          "ArrowDown",
          "ArrowUp",
        ].includes(input.key)
      )
        await session.page.keyboard.press(input.key);
      else if (input?.type === "scroll" && [-1, 1].includes(input.direction))
        await session.page.mouse.wheel(0, input.direction * 450);
      else throw new Error("Unsupported browser input.");
      await persist(key, session);
      return snapshot(session);
    }
    if (action === "finish") {
      const data = await collect(key, session);
      session.interactive = false;
      return data;
    }
    if (action === "cancel") {
      session.interactive = false;
      await persist(key, session);
      return { ok: true };
    }
    if (action === "scrape") {
      if (session.interactive)
        throw new Error(
          "Finish the EduPage connection screen before automatic sync.",
        );
      return collect(key, session);
    }
    throw new Error("Unsupported browser operation.");
  });
  res.set("Cache-Control", "no-store").json(result);
});
app.use((error, req, res, next) => {
  // Never serialize Playwright call logs, page HTML, URLs or entered values.
  const message =
    error.code === "EDUPAGE_LOGIN"
      ? error.message
      : /^EduPage|^Your EduPage|^Finish |^Use your|^Sign in|^Unsupported|^Open the/.test(
            error.message,
          )
        ? error.message
        : "The EduPage browser could not complete this step. Try reconnecting.";
  res.status(502).json({
    error: message,
    code: error.code === "EDUPAGE_LOGIN" ? error.code : undefined,
  });
});
setInterval(async () => {
  for (const [key, session] of sessions)
    if (Date.now() - session.used > 10 * 60000 && !locks.has(key)) {
      try {
        await persist(key, session);
        await session.context.close();
      } catch {}
      sessions.delete(key);
    }
}, 60000).unref();
const server = app.listen(
  Number(process.env.PORT || 3002),
  process.env.HOST || "0.0.0.0",
);
process.on("SIGTERM", async () => {
  server.close();
  for (const [key, session] of sessions)
    await persist(key, session).catch(() => {});
  await browser?.close();
  process.exit(0);
});
