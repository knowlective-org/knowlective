import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addMonths, dateKey, monthOf, monthWeeks, todayKey } from "../src/components/editor/calendar";

// The child page calendar's month grid (components/editor/calendar.ts).
describe("calendar", () => {
  test("whole weeks around the month, from Sunday", () => {
    // November 2026 starts on a Sunday and has 30 days: 5 weeks.
    const weeks = monthWeeks({ year: 2026, month: 11 });
    assert.equal(weeks.length, 5);
    assert.deepEqual(weeks[0][0], { date: "2026-11-01", day: 1, inMonth: true });
    assert.deepEqual(weeks[4][6], { date: "2026-12-05", day: 5, inMonth: false });
    assert.ok(weeks.every((w) => w.length === 7));
  });

  test("from Monday, with days of the month before", () => {
    const weeks = monthWeeks({ year: 2026, month: 11 }, 1);
    assert.deepEqual(weeks[0][0], { date: "2026-10-26", day: 26, inMonth: false });
    assert.equal(weeks[0][6].date, "2026-11-01");
    assert.equal(weeks.length, 6);
  });

  test("February in a leap year, and a month that fits four weeks", () => {
    const leap = monthWeeks({ year: 2028, month: 2 });
    assert.equal(leap.flat().filter((d) => d.inMonth).length, 29);
    // February 2026 starts on a Sunday: exactly 4 weeks.
    assert.equal(monthWeeks({ year: 2026, month: 2 }).length, 4);
  });

  test("months and dates", () => {
    assert.deepEqual(addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
    assert.deepEqual(addMonths({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
    assert.deepEqual(addMonths({ year: 2026, month: 5 }, -17), { year: 2024, month: 12 });
    assert.deepEqual(monthOf("2026-03-09"), { year: 2026, month: 3 });
    assert.equal(monthOf("not a date"), null);
    assert.equal(dateKey(2026, 3, 9), "2026-03-09");
    assert.equal(todayKey(new Date(2026, 0, 2, 23, 59)), "2026-01-02");
  });
});
