import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginStore, PluginRunner } from "../server/plugin-store.mjs";
import {
  assignmentEvent,
  filteredAssignments,
  syncAssignments,
} from "../server/plugin-sync.mjs";
import {
  dashboardData,
  assignmentsFrom,
  schoolOrigin,
} from "../worker/edupage.mjs";

test("plugin jobs are isolated, deduplicated, automatically triggered, and survive restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hypercal-plugins-"));
  try {
    let now = 100000,
      release;
    const store = new PluginStore(dir, () => now);
    const instance = store.add("alice", { type: "edupage", trigger: "open" });
    Object.assign(instance, { enabled: true, connected: true });
    store.save();
    let calls = 0;
    const runner = new PluginRunner(
      store,
      async () => {
        calls++;
        await new Promise((r) => {
          release = r;
        });
        return { message: "Imported", changed: true };
      },
      { now: () => now },
    );
    assert.equal(runner.activate("bob"), 0);
    assert.equal(runner.activate("alice"), 1);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    assert.equal(runner.activate("alice"), 0);
    runner.tick();
    assert.equal(calls, 1, "open-only plugins never run on a timer");
    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(instance.status, "success");
    assert.equal(
      runner.activate("alice"),
      0,
      "multiple device opens share a one-minute cooldown",
    );
    now += 61000;
    assert.equal(runner.activate("alice"), 1);
    await new Promise((r) => setImmediate(r));
    const restarted = new PluginStore(dir, () => now);
    assert.equal(restarted.get("alice", instance.id).status, "interrupted");
    assert.throws(() => restarted.get("bob", instance.id), /not found/);
    assert.equal(statSync(store.file).mode & 0o777, 0o600);
    runner.close();
    release();
    await new Promise((r) => setImmediate(r));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scheduled plugins run only when explicitly selected and respect pauses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hypercal-plugin-schedule-"));
  try {
    let now = 100000,
      calls = 0;
    const store = new PluginStore(dir, () => now);
    const instance = store.add("alice", {
      trigger: "interval",
      intervalMinutes: 60,
    });
    Object.assign(instance, { connected: true, enabled: true });
    const runner = new PluginRunner(
      store,
      async () => {
        calls++;
        return { message: "Done" };
      },
      { now: () => now },
    );
    runner.activate("alice");
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 0);
    runner.tick();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    now += 30 * 60000;
    runner.tick();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    now += 31 * 60000;
    instance.enabled = false;
    runner.tick();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    runner.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("EduPage parsing handles quoted JSON, subject names and date-only deadlines without inventing dates", () => {
  const data = {
    dbi: { subjects: { 7: { id: 7, name: "Mathematics" } } },
    homeworks: [
      {
        e_superid: "1",
        typ: "etest|exam",
        name: 'Test {"topic"}',
        datefrom: "2026-09-11",
        dateto: "2026-11-03",
        predmetid: 7,
      },
      {
        homeworkid: "2",
        typ: "etesthw|hw",
        name: "Practice",
        dateto: "2026-11-04 23:59:00",
        predmetid: 7,
      },
      {
        e_superid: "3",
        typ: "homework",
        name: "Invalid",
        dateto: "2026-02-30",
      },
      {
        e_superid: "4",
        typ: "sprava",
        name: "Private message",
        dateto: "2026-11-03",
      },
    ],
  };
  const parsed = dashboardData([
    "irrelevant",
    `$(x).userhome(${JSON.stringify(data)}); nextCall({});`,
  ]);
  assert.deepEqual(parsed, data);
  const result = assignmentsFrom(parsed, "https://smnd.edupage.org", {
    today: "2026-10-30",
  });
  assert.deepEqual(
    result.items.map((i) => [i.kind, i.subject, i.date]),
    [
      ["exam", "Mathematics", "2026-11-03"],
      ["homework", "Mathematics", "2026-11-04"],
    ],
  );
  assert.equal(result.skipped, 1);
  assert.throws(
    () => assignmentsFrom({}, "https://smnd.edupage.org"),
    /not recognized/,
  );
  assert.deepEqual(
    assignmentsFrom({ homeworks: [] }, "https://smnd.edupage.org").items,
    [],
  );
  for (const bad of [
    "http://smnd.edupage.org",
    "https://127.0.0.1",
    "https://edupage.org.evil.test",
    "https://name:secret@smnd.edupage.org",
  ])
    assert.throws(() => schoolOrigin(bad));
});

test("plugin sync filters safely and only updates deterministic plugin-owned events", async () => {
  const instance = {
    id: "plugin-one",
    owner: "alice",
    calendarId: "chosen/calendar",
    sources: {},
    exams: true,
    homework: true,
    excludeSubjects: ["History"],
    excludeRegex: "optional",
  };
  const items = [
    {
      id: "exam-1",
      kind: "exam",
      subject: "Math",
      title: "Exam",
      date: "2026-10-25",
      description: "",
      url: "https://smnd.edupage.org/user/",
    },
    {
      id: "hw-1",
      kind: "homework",
      subject: "Math",
      title: "Optional practice",
      date: "2026-11-01",
    },
    {
      id: "hw-2",
      kind: "homework",
      subject: "History",
      title: "Essay",
      date: "2026-11-02",
    },
  ];
  assert.equal(filteredAssignments(items, instance).length, 1);
  assert.throws(
    () =>
      filteredAssignments(items, {
        ...instance,
        excludeRegex: "(?=unsupported)",
      }),
    /Invalid exclusion/,
  );
  const body = assignmentEvent(instance, items[0]);
  assert.equal(body.end.date, "2026-10-26");
  assert.match(body.id, /^hc[a-f0-9]{48}$/);
  const remote = new Map();
  const calls = [];
  const request = async (account, path, options = {}) => {
    assert.equal(account, "alice");
    assert.ok(path.startsWith("calendars/chosen%2Fcalendar/events"));
    calls.push(options.method || "GET");
    if (options.method === "POST") {
      remote.set(options.body.id, {
        ...structuredClone(options.body),
        etag: "v1",
      });
      return options.body;
    }
    const id = path.split("/").at(-1);
    if (!options.method) return remote.get(id);
    assert.equal(options.etag, "v1");
    Object.assign(remote.get(id), options.body);
    return remote.get(id);
  };
  const api = { request, save() {} };
  assert.equal((await syncAssignments(instance, items, api)).created, 1);
  assert.equal((await syncAssignments(instance, items, api)).unchanged, 1);
  assert.deepEqual(calls, ["POST"]);
  remote.get(body.id).extendedProperties.private.customColor = "keep";
  remote.get(body.id).extendedProperties.shared = { hypercalTags: '["Exam"]' };
  items[0].title = "Updated exam";
  assert.equal((await syncAssignments(instance, items, api)).updated, 1);
  assert.deepEqual(calls, ["POST", "GET", "PATCH"]);
  assert.equal(
    remote.get(body.id).extendedProperties.private.customColor,
    "keep",
  );
  assert.equal(
    remote.get(body.id).extendedProperties.shared.hypercalTags,
    '["Exam"]',
  );
  remote.get(body.id).extendedProperties.private.hypercalPlugin =
    "another-plugin";
  items[0].title = "Changed again";
  await assert.rejects(
    syncAssignments(instance, items, api),
    /No event was overwritten/,
  );
});

test("retry after an interrupted insert recovers through provider IDs without duplicates", async () => {
  const instance = {
    id: "one",
    owner: "alice",
    calendarId: "target",
    sources: {},
    homework: true,
    exams: true,
    excludeSubjects: [],
    excludeRegex: "",
  };
  const item = {
    id: "a",
    subject: "Math",
    title: "Exam",
    kind: "exam",
    date: "2026-11-02",
    url: "https://smnd.edupage.org/user/",
  };
  const existing = assignmentEvent(instance, item);
  existing.etag = "v1";
  let patched = false;
  const result = await syncAssignments(instance, [item], {
    save() {},
    request: async (owner, path, options = {}) => {
      if (options.method === "POST")
        throw Object.assign(new Error("Exists"), { status: 409 });
      if (!options.method) return existing;
      assert.equal(options.method, "PATCH");
      patched = true;
      return existing;
    },
  });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(patched, true);
});
