import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, ganttDays, isGanttRange, moveSpan, pageSpan, placeSpan, resizeSpan, shiftAnchor } from "../src/components/editor/gantt";

test("the days of a week, a month and three months", () => {
  const week = ganttDays("2026-11-25", "week");
  assert.deepEqual([week[0], week[6], week.length], ["2026-11-22", "2026-11-28", 7]);
  const month = ganttDays("2028-02-15", "month");
  assert.deepEqual([month[0], month[month.length - 1], month.length], ["2028-02-01", "2028-02-29", 29]);
  const quarter = ganttDays("2026-11-25", "quarter");
  assert.deepEqual([quarter[0], quarter[quarter.length - 1], quarter.length], ["2026-11-01", "2027-01-31", 92]);
});

test("a year and three years are whole calendar years, with leap days", () => {
  const year = ganttDays("2028-11-25", "year");
  assert.deepEqual([year[0], year[year.length - 1], year.length], ["2028-01-01", "2028-12-31", 366]);
  const three = ganttDays("2026-11-25", "threeYears");
  assert.deepEqual([three[0], three[three.length - 1], three.length], ["2026-01-01", "2028-12-31", 1096]);
  assert.equal(shiftAnchor("2028-02-29", "year", 1).slice(0, 4), "2029");
  assert.equal(shiftAnchor("2026-11-25", "threeYears", -1).slice(0, 4), "2023");
});

test("moving by a period crosses years and doesn't drift at month ends", () => {
  assert.equal(shiftAnchor("2026-12-31", "month", 1), "2027-01-01");
  assert.equal(shiftAnchor("2026-01-31", "quarter", -1), "2025-10-01");
  assert.equal(shiftAnchor("2026-11-25", "week", 1), "2026-12-02");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
});

test("a page's span from its dates", () => {
  assert.deepEqual(pageSpan("2026-11-02", "2026-11-05"), { start: "2026-11-02", end: "2026-11-05" });
  assert.deepEqual(pageSpan("2026-11-02", ""), { start: "2026-11-02", end: "2026-11-02" });
  assert.deepEqual(pageSpan("", "2026-11-05"), { start: "2026-11-05", end: "2026-11-05" });
  assert.deepEqual(pageSpan("2026-11-05", "2026-11-02"), { start: "2026-11-05", end: "2026-11-05" });
  assert.equal(pageSpan("nope", ""), null);
  assert.equal(pageSpan("", ""), null);
});

test("a span on the days shown, cut at their edges", () => {
  const days = ganttDays("2026-11-25", "week");
  assert.deepEqual(placeSpan({ start: "2026-11-23", end: "2026-11-24" }, days), { from: 1, to: 2, before: false, after: false });
  assert.deepEqual(placeSpan({ start: "2026-11-01", end: "2026-12-30" }, days), { from: 0, to: 6, before: true, after: true });
  assert.equal(placeSpan({ start: "2026-11-29", end: "2026-11-30" }, days), null);
  assert.equal(placeSpan({ start: "2026-11-01", end: "2026-11-21" }, days), null);
});

test("moving and resizing keep the start at or before the end", () => {
  const span = { start: "2026-11-10", end: "2026-11-12" };
  assert.deepEqual(moveSpan(span, -10), { start: "2026-10-31", end: "2026-11-02" });
  assert.deepEqual(resizeSpan(span, "end", 3), { start: "2026-11-10", end: "2026-11-15" });
  assert.deepEqual(resizeSpan(span, "end", -9), { start: "2026-11-10", end: "2026-11-10" });
  assert.deepEqual(resizeSpan(span, "start", 9), { start: "2026-11-12", end: "2026-11-12" });
});

test("only the known ranges are accepted from the shared document", () => {
  assert.equal(isGanttRange("quarter"), true);
  assert.equal(isGanttRange("threeYears"), true);
  assert.equal(isGanttRange("decade"), false);
  assert.equal(isGanttRange(null), false);
});
