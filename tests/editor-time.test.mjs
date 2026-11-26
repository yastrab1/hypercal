import test from "node:test";
import assert from "node:assert/strict";
import { eventInstant, zonedInput } from "../src/editor-time.mjs";
test("editor dates use the selected zone, including midnight and offset transitions", () => {
  assert.equal(
    zonedInput("2026-06-01T00:00Z", "America/New_York"),
    "2026-05-31T20:00",
  );
  assert.equal(
    eventInstant("2026-06-01", "09:00", "Asia/Kathmandu"),
    "2026-06-01T03:15:00.000Z",
  );
  assert.throws(
    () => eventInstant("2026-03-08", "02:30", "America/New_York"),
    /does not exist/,
  );
  assert.equal(
    eventInstant(
      "2026-11-01",
      "01:30",
      "America/New_York",
      "2026-11-01T06:30:47Z",
    ),
    "2026-11-01T06:30:47.000Z",
  );
});
