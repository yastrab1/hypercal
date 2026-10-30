import test from "node:test";
import assert from "node:assert/strict";
import { observeMonthWheel } from "../src/month-wheel.mjs";

const wheel = (element, x, y, options = {}) => {
  const event = Object.assign(new Event("wheel", { cancelable: true }), {
    deltaX: x,
    deltaY: y,
    deltaMode: 0,
    ctrlKey: false,
    ...options,
  });
  element.dispatchEvent(event);
  return event.defaultPrevented;
};
test("horizontal month gestures navigate once including momentum, then reverse after idle", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const element = new EventTarget();
  const steps = [];
  const stop = observeMonthWheel(element, (step) => steps.push(step));
  assert.equal(wheel(element, 24, 1), true);
  assert.deepEqual(steps, []);
  wheel(element, 26, 2);
  wheel(element, 150, 0);
  t.mock.timers.tick(200);
  wheel(element, 10, 0);
  assert.deepEqual(steps, [1]);
  t.mock.timers.tick(280);
  wheel(element, -60, 0);
  assert.deepEqual(steps, [1, -1]);
  stop();
  wheel(element, 100, 0);
  assert.deepEqual(steps, [1, -1]);
});
test("vertical scrolling and pinch zoom never switch months; line deltas work", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const element = new EventTarget();
  const steps = [];
  const stop = observeMonthWheel(element, (step) => steps.push(step));
  assert.equal(wheel(element, 5, 80), false);
  wheel(element, 80, 5);
  assert.deepEqual(steps, []);
  t.mock.timers.tick(280);
  assert.equal(wheel(element, 100, 0, { ctrlKey: true }), false);
  assert.deepEqual(steps, []);
  wheel(element, 3, 0, { deltaMode: 1 });
  assert.deepEqual(steps, [1]);
  stop();
});
