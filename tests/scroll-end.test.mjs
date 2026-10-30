import test from "node:test";
import assert from "node:assert/strict";
import { observeScrollEnd } from "../src/scroll-end.mjs";

function touch(element, type, fingers) {
  const event = new Event(type);
  event.touches = Array(fingers);
  element.dispatchEvent(event);
}

test("native scrollend waits for inertia and never settles with fingers down", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const element = new EventTarget();
  element.onscrollend = null;
  let calls = 0;
  const stop = observeScrollEnd(element, () => calls++);
  touch(element, "touchstart", 1);
  element.dispatchEvent(new Event("scroll"));
  t.mock.timers.tick(1000);
  element.dispatchEvent(new Event("scrollend"));
  assert.equal(calls, 0);
  touch(element, "touchend", 0);
  element.dispatchEvent(new Event("scroll"));
  t.mock.timers.tick(1000);
  assert.equal(calls, 0, "release timeout cannot interrupt native inertia");
  element.dispatchEvent(new Event("scrollend"));
  assert.equal(calls, 1);
  t.mock.timers.tick(1000);
  assert.equal(
    calls,
    1,
    "native completion cancels the touch-release fallback",
  );
  stop();
});

test("older WebViews debounce scrolling, preserve multitouch, and clean up timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const element = new EventTarget();
  let calls = 0;
  const stop = observeScrollEnd(element, () => calls++);
  element.dispatchEvent(new Event("scroll"));
  t.mock.timers.tick(200);
  element.dispatchEvent(new Event("scroll"));
  t.mock.timers.tick(200);
  assert.equal(calls, 0);
  touch(element, "touchstart", 2);
  touch(element, "touchend", 1);
  t.mock.timers.tick(1000);
  assert.equal(calls, 0);
  touch(element, "touchend", 0);
  t.mock.timers.tick(280);
  assert.equal(calls, 1);
  element.dispatchEvent(new Event("scroll"));
  stop();
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
});
