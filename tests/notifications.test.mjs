import test from "node:test";
import assert from "node:assert/strict";
import {
  validNotification,
  notificationFields,
  notificationParts,
} from "../src/notifications.mjs";
test("notification choices distinguish calendar defaults, none, event time and custom amounts", () => {
  assert.deepEqual(notificationFields("calendar"), {
    useDefaultReminders: true,
  });
  assert.deepEqual(notificationFields("none"), { reminderMinutes: null });
  assert.deepEqual(notificationFields("0"), { reminderMinutes: 0 });
  for (const n of [75, 120, 2880, 40320])
    assert.deepEqual(notificationFields(String(n)), { reminderMinutes: n });
});
test("custom notifications retain their amount and unit when reopened", () => {
  assert.deepEqual(notificationParts("120"), { amount: 2, unit: 60 });
  assert.deepEqual(notificationParts("2880"), { amount: 2, unit: 1440 });
  assert.deepEqual(notificationParts("75"), { amount: 75, unit: 1 });
  assert.deepEqual(notificationParts("0"), { amount: 0, unit: 1 });
});
test("Google notification bounds reject invalid or fractional minutes", () => {
  for (const value of ["", "-1", "0.5", "40321", "Infinity", "junk"]) {
    assert.equal(validNotification(value), false);
    assert.throws(() => notificationFields(value));
  }
});
