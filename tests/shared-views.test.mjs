import test from "node:test";
import assert from "node:assert/strict";
import { SharedStore, tokenHash } from "../server/shared-store.mjs";
import { aggregateShared, sharedICS } from "../server/shared-views.mjs";

test("invitations bind to a named account, expire, revoke and are consumed once", () => {
  const store = new SharedStore(":memory:");
  try {
    const v = store.create("alice", "alice@example.test", {
      name: "School",
      layout: "month",
    });
    assert.deepEqual(v.members.alice.contributions, []);
    const invite = store.invite(v.id, "alice", "bob@example.test");
    assert.ok(!JSON.stringify(store.get(v.id)).includes(invite));
    assert.throws(
      () => store.accept(invite, "carol", "carol@example.test"),
      (e) => e.status === 403,
    );
    assert.throws(
      () => store.member(v.id, "bob"),
      (e) => e.status === 404,
    );
    store.accept(invite, "bob", "bob@example.test");
    assert.ok(store.member(v.id, "bob"));
    assert.throws(
      () => store.accept(invite, "bob", "bob@example.test"),
      (e) => e.status === 404,
    );
    assert.throws(
      () => store.invite(v.id, "bob", "carol@example.test"),
      (e) => e.status === 403,
    );
    const expired = store.invite(v.id, "alice", "carol@example.test");
    store.mutate(v.id, (v) => {
      v.invitations.find((i) => i.hash === tokenHash(expired)).expiresAt = 0;
    });
    assert.throws(
      () => store.accept(expired, "carol", "carol@example.test"),
      (e) => e.status === 404,
    );
    store.mutate(v.id, (v) => {
      delete v.members.bob;
    });
    assert.throws(
      () => store.member(v.id, "bob"),
      (e) => e.status === 404,
    );
  } finally {
    store.close();
  }
});
test("public links have separate scopes and stop working on revoke, expiry or view deletion", () => {
  const store = new SharedStore(":memory:");
  try {
    const v = store.create("alice", "alice@example.test", {
      name: "Friends",
      layout: "week",
    });
    const web = store.link(v.id, "alice", "web"),
      ics = store.link(v.id, "alice", "ical");
    assert.equal(store.publicView(web, "web").id, v.id);
    assert.throws(
      () => store.publicView(web, "ical"),
      (e) => e.status === 404,
    );
    store.mutate(v.id, (v) => {
      v.links = v.links.filter((l) => l.hash !== tokenHash(web));
    });
    assert.throws(
      () => store.publicView(web, "web"),
      (e) => e.status === 404,
    );
    assert.equal(store.publicView(ics, "ical").id, v.id);
    store.mutate(v.id, (v) => {
      v.links[0].expiresAt = 0;
    });
    assert.throws(
      () => store.publicView(ics, "ical"),
      (e) => e.status === 404,
    );
    const last = store.link(v.id, "alice", "web");
    store.delete(v.id, "alice");
    assert.throws(
      () => store.publicView(last, "web"),
      (e) => e.status === 404,
    );
  } finally {
    store.close();
  }
});
const event = {
  id: "same-event-id",
  calendarId: "primary",
  title: "Private lesson",
  description: "hidden medical note",
  location: "Secret location",
  start: "2026-10-28T10:00:00Z",
  end: "2026-10-28T11:00:00Z",
  allDay: false,
  htmlLink: "private",
  etag: "private",
};
const view = {
  id: "shared",
  include: "",
  exclude: "",
  hideAllDay: false,
  members: {
    alice: {
      email: "alice@example.test",
      contributions: [
        { calendarId: "primary", detail: "details", publicAllowed: false },
      ],
    },
    bob: {
      email: "bob@example.test",
      contributions: [
        { calendarId: "primary", detail: "busy", publicAllowed: true },
      ],
    },
  },
};
const load = async (accountId) => ({
  calendar: { summary: "Personal", backgroundColor: "#18ab72" },
  events: [{ ...event, title: `${accountId} lesson` }],
});
test("shared aggregation qualifies identical provider IDs by account and forces read-only output", async () => {
  const requests = [];
  const result = await aggregateShared(
    view,
    "from",
    "to",
    false,
    async (...args) => {
      requests.push(args[0]);
      return load(...args);
    },
  );
  assert.deepEqual(requests.sort(), ["alice", "bob"]);
  assert.equal(new Set(result.events.map((e) => e.id)).size, 2);
  assert.equal(new Set(result.events.map((e) => e.calendarId)).size, 2);
  assert.ok(result.events.every((e) => e.readOnly && !e.htmlLink && !e.etag));
  assert.equal(result.events.find((e) => e.title === "Busy").description, "");
  assert.equal(
    result.events.find((e) => e.title === "alice lesson").location,
    "Secret location",
  );
});
test("public aggregation requires each contribution opt-in and always removes notes, locations and identities", async () => {
  const result = await aggregateShared(view, "from", "to", true, load);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, "Busy");
  const output = JSON.stringify(result);
  for (const hidden of [
    "medical",
    "Secret location",
    "alice@example",
    "bob@example",
    "primary",
    "same-event-id",
    "private",
  ])
    assert.ok(!output.includes(hidden));
  const opted = structuredClone(view);
  opted.members.alice.contributions[0].publicAllowed = true;
  const publicResult = await aggregateShared(opted, "from", "to", true, load);
  assert.equal(
    publicResult.events.find((e) => e.title === "alice lesson").description,
    "",
  );
});
test("filters cannot disclose text removed by a contributor policy", async () => {
  for (const include of ["medical", "secret", "bob lesson"]) {
    const result = await aggregateShared(
      { ...view, include },
      "from",
      "to",
      true,
      load,
    );
    assert.deepEqual(result.events, []);
  }
  const privateResult = await aggregateShared(
    { ...view, include: "medical" },
    "from",
    "to",
    false,
    load,
  );
  assert.equal(privateResult.events.length, 1);
  assert.equal(privateResult.events[0].title, "alice lesson");
});
test("iCalendar export escapes content, preserves exclusive all-day ends and folds UTF-8 safely", () => {
  const text = sharedICS(
    [
      {
        ...event,
        id: "safe",
        title: "Lesson\nEND:VEVENT; fake, " + "ž".repeat(100),
        allDay: true,
        start: "2026-10-28",
        end: "2026-10-30",
      },
    ],
    "Shared",
  );
  assert.ok(text.includes("DTEND;VALUE=DATE:20261030"));
  assert.equal(
    text.split("\r\n").filter((line) => line === "END:VEVENT").length,
    1,
  );
  assert.ok(text.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.ok(!text.includes("medical"));
  assert.ok(!text.includes("Secret location"));
});
