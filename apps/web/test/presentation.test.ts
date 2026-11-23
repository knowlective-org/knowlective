import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  isNumberPosition,
  isNumberStart,
  nearestShownSlide,
  readSettings,
  shownSlides,
  slideNumbers,
} from "../src/lib/presentation";

const on = { ...DEFAULT_SETTINGS, numberingEnabled: true };
const numbers = (order: string[], s: typeof on) => order.map((id) => slideNumbers(order, s).get(id));

test("slides are numbered in order from the start number", () => {
  assert.deepEqual(numbers(["a", "b", "c"], on), [1, 2, 3]);
  assert.deepEqual(numbers(["a", "b"], { ...on, numberStart: 5 }), [5, 6]);
});

test("no numbers while numbering is off", () => {
  assert.deepEqual(numbers(["a", "b"], DEFAULT_SETTINGS), [null, null]);
});

test("a slide with only its number hidden is still counted", () => {
  assert.deepEqual(numbers(["cover", "b", "c"], { ...on, numberHiddenSlideIds: ["cover"] }), [null, 2, 3]);
  assert.deepEqual(numbers(["cover", "b", "c"], { ...on, numberStart: 0, numberHiddenSlideIds: ["cover"] }), [null, 1, 2]);
});

test("a hidden slide is not counted", () => {
  assert.deepEqual(numbers(["a", "hidden", "c"], { ...on, hiddenSlideIds: ["hidden"] }), [1, null, 2]);
});

test("shown slides leave out the hidden ones", () => {
  assert.deepEqual(shownSlides(["a", "b", "c"], { hiddenSlideIds: ["b"] }), ["a", "c"]);
});

test("the nearest shown slide is the next one, else the previous one", () => {
  const order = ["a", "b", "c"];
  assert.equal(nearestShownSlide(order, { hiddenSlideIds: [] }, "b"), "b");
  assert.equal(nearestShownSlide(order, { hiddenSlideIds: ["b"] }, "b"), "c");
  assert.equal(nearestShownSlide(order, { hiddenSlideIds: ["c"] }, "c"), "b");
  assert.equal(nearestShownSlide(order, { hiddenSlideIds: ["a", "b", "c"] }, "b"), null);
  assert.equal(nearestShownSlide(order, { hiddenSlideIds: [] }, "gone"), "a");
});

test("stored settings out of range fall back to the defaults", () => {
  const read = readSettings({ numberingEnabled: true, numberStart: -3, numberPosition: "top", hiddenSlideIds: [], numberHiddenSlideIds: [] });
  assert.equal(read.numberStart, 1);
  assert.equal(read.numberPosition, "right");
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
});

test("number settings are validated", () => {
  for (const bad of [-1, 1.5, 10000, "1", null, Number.NaN]) assert.equal(isNumberStart(bad), false);
  assert.equal(isNumberStart(0), true);
  assert.equal(isNumberPosition("center"), true);
  assert.equal(isNumberPosition("top"), false);
});
