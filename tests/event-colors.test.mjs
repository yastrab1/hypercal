import test from "node:test";
import assert from "node:assert/strict";
import {
  googleColorFields,
  readEventColor,
  eventColor,
  defaultEventColors,
} from "../src/event-colors.mjs";
import { copiedEventBody } from "../server/copy-event.mjs";

test("custom colors round-trip through Google private metadata with a supported fallback", () => {
  const fields = googleColorFields("#18ab72");
  assert.match(fields.colorId, /^(?:[1-9]|10|11)$/);
  assert.equal(readEventColor(fields), "#18ab72");
  assert.equal(readEventColor({ ...fields, colorId: "11" }), "#d50000");
  assert.equal(googleColorFields("#d50000").colorId, "11");
  assert.equal(readEventColor({ colorId: "11" }), "#d50000");
  assert.deepEqual(googleColorFields(undefined), {});
  assert.deepEqual(googleColorFields(null), {
    colorId: "0",
    extendedProperties: { private: { hypercalColor: "default" } },
  });
  assert.equal(
    readEventColor({
      extendedProperties: { private: { hypercalColor: "unsafe" } },
    }),
    undefined,
  );
});

test("reset colors inherit the calendar; copies retain only HyperCal color metadata", () => {
  assert.equal(
    eventColor({ calendarId: "school", color: null }, [
      { id: "school", color: "#123456" },
    ]),
    "#123456",
  );
  const copy = copiedEventBody({
    start: { date: "2026-10-28" },
    end: { date: "2026-10-29" },
    colorId: "2",
    extendedProperties: {
      private: { hypercalColor: "#18ab72", privateProviderData: "omit" },
    },
  });
  assert.equal(copy.colorId, "2");
  assert.deepEqual(copy.extendedProperties, {
    private: { hypercalColor: "#18ab72" },
  });
});

test("reference swatches preserve their exact color through Google metadata", () => {
  assert.equal(defaultEventColors.length, 24);
  assert.equal(new Set(defaultEventColors.map((c) => c.hex)).size, 24);
  for (const color of defaultEventColors)
    assert.equal(readEventColor(googleColorFields(color.hex)), color.hex);
});
