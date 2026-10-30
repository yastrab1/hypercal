import test from "node:test";
import assert from "node:assert/strict";
import { continuousFor } from "../src/scroll-options.mjs";
test("view scrolling settings stay independent by device and inherit legacy choices", () => {
  const view = {
    continuousScroll: true,
    continuousScrollWeb: true,
    continuousScrollPhone: false,
  };
  assert.equal(continuousFor(view, false), true);
  assert.equal(continuousFor(view, true), false);
  assert.equal(
    continuousFor(
      { ...view, continuousScrollWeb: false, continuousScrollPhone: true },
      false,
    ),
    false,
  );
  assert.equal(
    continuousFor(
      { ...view, continuousScrollWeb: false, continuousScrollPhone: true },
      true,
    ),
    true,
  );
  for (const phone of [true, false]) {
    assert.equal(continuousFor({ continuousScroll: false }, phone), false);
    assert.equal(continuousFor({ continuousScroll: true }, phone), true);
    assert.equal(continuousFor(null, phone), true);
  }
});
