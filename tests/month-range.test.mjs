import test from "node:test";
import assert from "node:assert/strict";
import { differenceInCalendarDays, format } from "date-fns";
import { monthRange } from "../src/period.mjs";

test("phone months always include six complete Monday-first weeks", () => {
  for (let year = 2026; year <= 2028; year++)
    for (let month = 0; month < 12; month++) {
      const { from, to } = monthRange(new Date(year, month, 15), true);
      assert.equal(from.getDay(), 1);
      assert.equal(to.getDay(), 1);
      assert.equal(differenceInCalendarDays(to, from), 42);
      assert.ok(from <= new Date(year, month, 1));
      assert.ok(to > new Date(year, month + 1, 0));
    }
});
test("sixth-row events are fetched even for a February starting Monday", () => {
  const { from, to } = monthRange(new Date(2027, 1, 1), true);
  assert.equal(format(from, "yyyy-MM-dd"), "2027-02-01");
  assert.equal(format(to, "yyyy-MM-dd"), "2027-03-15");
  assert.equal(differenceInCalendarDays(monthRange(from).to, from), 28);
});
