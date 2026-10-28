import test from "node:test";
import assert from "node:assert/strict";
import { filterEvents, layoutEvents } from "../src/domain.mjs";
import { parseFeed, isPrivateIP, validateFeedUrl } from "../server/feeds.mjs";
const events = [
  {
    id: "lecture",
    calendarId: "school",
    title: "Algebra lecture",
    description: "Linear systems",
    location: "Room B",
    allDay: false,
  },
  {
    id: "exam",
    calendarId: "school",
    title: "Final exam",
    description: "Bring your ID",
    location: "Auditorium",
    allDay: false,
  },
  {
    id: "deadline",
    calendarId: "projects",
    title: "Deadline",
    description: "",
    location: "",
    allDay: true,
  },
];
test("monthly filters exclude lessons without changing source events", () => {
  const copy = structuredClone(events);
  assert.deepEqual(
    filterEvents(events, {
      calendarIds: ["school", "projects"],
      include: "",
      exclude: "lecture",
      hideAllDay: false,
    }).map((e) => e.id),
    ["exam", "deadline"],
  );
  assert.deepEqual(events, copy);
});
test("include is OR across phrases and fields; excludes take priority", () => {
  assert.deepEqual(
    filterEvents(events, {
      calendarIds: ["school"],
      include: "AUDITORIUM, linear systems",
      exclude: "lecture",
      hideAllDay: false,
    }).map((e) => e.id),
    ["exam"],
  );
});
test("calendar selection and all-day flags apply independently", () => {
  assert.equal(
    filterEvents(events, {
      calendarIds: ["projects"],
      include: "",
      exclude: "",
      hideAllDay: true,
    }).length,
    0,
  );
  assert.equal(
    filterEvents(events, {
      calendarIds: [],
      include: "",
      exclude: "",
      hideAllDay: false,
    }).length,
    0,
  );
});
test("overlapping event chains share width; separate groups recover full width", () => {
  const es = layoutEvents([
    { id: "a", startMinute: 60, endMinute: 120 },
    { id: "b", startMinute: 90, endMinute: 150 },
    { id: "c", startMinute: 120, endMinute: 180 },
    { id: "d", startMinute: 200, endMinute: 240 },
  ]);
  assert.deepEqual(
    es.map((e) => [e.id, e.column, e.columns]),
    [
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ],
  );
});
test("iCal expands recurrence, excludes dates and honors modified occurrences", () => {
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:course\r\nDTSTART:20261026T090000Z\r\nDTEND:20261026T100000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEXDATE:20261027T090000Z\r\nSUMMARY:Lecture\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:course\r\nRECURRENCE-ID:20261028T090000Z\r\nDTSTART:20261028T110000Z\r\nDTEND:20261028T120000Z\r\nSUMMARY:Moved lecture\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const result = parseFeed(
    ics,
    { id: "feed" },
    "2026-10-26T00:00:00Z",
    "2026-10-31T00:00:00Z",
  );
  assert.equal(result.length, 4);
  assert.equal(
    result.find((e) => e.title === "Moved lecture").start,
    "2026-10-28T11:00:00.000Z",
  );
  assert(result.every((e) => e.readOnly));
});
test("all-day iCal retains exclusive end date and overlap semantics", () => {
  const text =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20261028\r\nDTEND;VALUE=DATE:20261030\r\nSUMMARY:Break\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const sub = { id: "ical" };
  const es = parseFeed(
    text,
    sub,
    "2026-10-29T00:00:00Z",
    "2026-10-30T00:00:00Z",
  );
  assert.equal(es.length, 1);
  assert.equal(es[0].start, "2026-10-28");
  assert.equal(es[0].end, "2026-10-30");
  assert.equal(es[0].allDay, true);
  assert.equal(
    parseFeed(text, sub, "2026-10-30T00:00:00Z", "2026-10-31T00:00:00Z").length,
    0,
  );
});
test("subscription fetch rejects local and tailnet IPs", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "100.88.154.64",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "169.254.169.254",
  ])
    assert.equal(isPrivateIP(ip), true, ip);
  assert.equal(isPrivateIP("8.8.8.8"), false);
  assert.equal(isPrivateIP("2606:4700:4700::1111"), false);
  await assert.rejects(validateFeedUrl("http://127.0.0.1/calendar"));
  await assert.rejects(validateFeedUrl("file:///etc/passwd"));
  await assert.rejects(validateFeedUrl("https://user:secret@example.com/a"));
});

const { weekSegments, spansDays } = await import("../src/domain.mjs");
const ribbon = (id, start, end, allDay = true) => ({
  id,
  calendarId: "school",
  title: id,
  start,
  end,
  allDay,
});
test("multi-day ribbons connect cells with exclusive end dates and week continuation", () => {
  const event = ribbon("trip", "2026-10-30", "2026-11-04");
  const first = weekSegments([event], new Date("2026-10-26T12:00:00"));
  assert.deepEqual(
    first.map((s) => [s.start, s.end, s.continuesBefore, s.continuesAfter]),
    [[4, 7, false, true]],
  );
  const next = weekSegments([event], new Date("2026-11-02T12:00:00"));
  assert.deepEqual(
    next.map((s) => [s.start, s.end, s.continuesBefore, s.continuesAfter]),
    [[0, 2, true, false]],
  );
  assert.equal(
    weekSegments([event], new Date("2026-11-09T12:00:00")).length,
    0,
  );
});
test("overlapping ribbons occupy separate lanes and adjacent events reuse lanes", () => {
  const segments = weekSegments(
    [
      ribbon("a", "2026-10-26", "2026-10-29"),
      ribbon("b", "2026-10-27", "2026-10-30"),
      ribbon("c", "2026-10-29", "2026-10-31"),
    ],
    new Date("2026-10-26T12:00:00"),
  );
  assert.deepEqual(
    segments.map((s) => [s.event.id, s.lane]),
    [
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ],
  );
});
test("timed events ending at midnight do not spill into an extra day", () => {
  const one = ribbon(
    "one",
    "2026-10-28T08:00:00",
    "2026-10-29T00:00:00",
    false,
  );
  assert.equal(spansDays(one), false);
  const multi = ribbon(
    "travel",
    "2026-10-28T20:00:00",
    "2026-10-30T09:00:00",
    false,
  );
  assert.equal(spansDays(multi), true);
  assert.deepEqual(
    weekSegments([multi], new Date("2026-10-26T12:00:00")).map((s) => [
      s.start,
      s.end,
    ]),
    [[2, 5]],
  );
});
test("calendar-day spans remain stable through the daylight-saving transition", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Prague";
  try {
    const e = ribbon("break", "2026-10-24", "2026-10-27");
    assert.deepEqual(
      weekSegments([e], new Date("2026-10-19T12:00:00")).map((s) => [
        s.start,
        s.end,
      ]),
      [[5, 7]],
    );
    assert.deepEqual(
      weekSegments([e], new Date("2026-10-26T12:00:00")).map((s) => [
        s.start,
        s.end,
      ]),
      [[0, 1]],
    );
  } finally {
    if (previous) process.env.TZ = previous;
    else delete process.env.TZ;
  }
});

test("each layout resolves its own default and changing one leaves other defaults intact", async () => {
  const { getDefaultView, assignLayoutDefault } =
    await import("../src/domain.mjs");
  const source = [
    { id: "school", layout: "day", isDefault: true },
    { id: "personal", layout: "day", isDefault: false },
    { id: "highlights", layout: "month", isDefault: true },
  ];
  const next = assignLayoutDefault(source, "day", "personal");
  assert.equal(getDefaultView(next, "day").id, "personal");
  assert.equal(getDefaultView(next, "month").id, "highlights");
  assert.equal(getDefaultView(next, "week"), null);
  assert.equal(source[0].isDefault, true);
  assert.equal(
    getDefaultView(assignLayoutDefault(next, "day", null), "day"),
    null,
  );
});
