import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLIP_ATTR, clipBounds, clipHtml, clipItems, clipText, nearestColor, plainText, readClip } from "../src/components/whiteboard/clipboard";
import type { WhiteboardItem } from "../src/lib/whiteboard";

// Copying and pasting on a whiteboard (components/whiteboard/clipboard.ts):
// the board's own items, and what Miro copies.

const box = (id: string, x: number, y: number, text = ""): WhiteboardItem => ({
  id,
  type: "rect",
  x,
  y,
  w: 100,
  h: 50,
  text,
  textX: 0,
  textY: 0,
  color: "blue",
  z: 1,
  src: "",
  link: "",
  connectorEnds: "spread",
});

const connector = (id: string, from: string, to: string): WhiteboardItem => ({
  id,
  type: "connector",
  from,
  to,
  arrows: "end",
  route: "elbow",
  stroke: "dashed",
  fromSide: "right",
  toSide: null,
  text: "yes",
  startText: "",
  endText: "",
  color: "gray",
  z: 3,
});

// Miro's clipboard HTML around a document (each byte plus 59, Base64).
function miroHtml(objects: unknown[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ data: { objects, meta: {} }, version: 2 }));
  const shifted = Uint8Array.from(bytes, (b) => (b + 59) & 255);
  const base64 = Buffer.from(shifted).toString("base64");
  return `<meta charset="utf-8"><span data-meta="&lt;--(miro-data-v1)${base64}(/miro-data-v1)--&gt;"></span><p>fallback</p>`;
}

const widget = (type: string, json: Record<string, unknown>) => ({ type: 14, widgetData: { type, json } });
const at = (x: number, y: number) => ({ _position: { offsetPx: { x, y }, schema: "canvasOffsetPx" } });

describe("the board's own clipboard", () => {
  test("the selection and the connectors between it round-trip", () => {
    const items = [box("a", 0, 0, "A"), box("b", 200, 0, "B & <c>"), box("c", 0, 200), connector("k", "a", "b"), connector("l", "a", "c")];
    const chosen = clipItems(items, new Set(["a", "b", "l"]));
    assert.deepEqual(
      chosen.map((i) => i.id),
      ["a", "b", "k"],
    );
    const clip = readClip(clipHtml("page1", chosen));
    assert.ok(clip);
    assert.equal(clip.page, "page1");
    assert.deepEqual(clip.items, chosen);
    assert.match(clipHtml("page1", chosen), /<p>B &amp; &lt;c&gt;<\/p>/);
  });

  test("text for other apps, top to bottom", () => {
    assert.equal(clipText([box("b", 0, 100, "second"), box("a", 50, 0, "first"), box("c", 0, 200, " ")]), "first\nsecond");
  });

  test("what's put in the attribute is checked like the document", () => {
    const evil = { v: 1, page: "p", items: [{ id: "x", type: "image", x: 0, y: 0, w: 10, h: 10, src: "https://evil.example/a.png" }, { id: "y", type: "script" }, { id: "z", type: "connector", from: "x", to: "gone" }] };
    const html = `<div ${CLIP_ATTR}="${Buffer.from(JSON.stringify(evil)).toString("base64")}"></div>`;
    const clip = readClip(html);
    assert.ok(clip);
    assert.equal(clip.items.length, 1);
    assert.equal(clip.items[0].type, "image");
    assert.equal((clip.items[0] as { src: string }).src, "");
  });

  test("other HTML is not a clip", () => {
    assert.equal(readClip("<p>hello</p>"), null);
    assert.equal(readClip(`<div ${CLIP_ATTR}="!!!"></div>`), null);
  });

  test("bounds", () => {
    assert.deepEqual(clipBounds([box("a", 0, 0), box("b", 200, 100)]), { x: 0, y: 0, w: 300, h: 150 });
    assert.equal(clipBounds([]), null);
  });
});

describe("pasted from Miro", () => {
  test("stickies, shapes and a connector with a label", () => {
    const clip = readClip(
      miroHtml([
        widget("sticker", { ...at(0, 0), scale: { scale: 0.5 }, size: { width: 200, height: 220 }, text: "<p>テスト</p><p>2行目</p>", style: JSON.stringify({ sbc: 0x6ae08d }) }),
        widget("shape", { ...at(300, 0), scale: { scale: 1 }, size: { width: 120, height: 60 }, text: "<p>A &amp; B</p>", shape: "8", style: JSON.stringify({ bc: -1 }) }),
        widget("line", {
          primary: { point: { x: 1, y: 0.5 }, positionType: 0, widgetIndex: 0 },
          secondary: { point: { x: 0, y: 0.5 }, positionType: 0, widgetIndex: 1 },
          style: JSON.stringify({ a_start: 0, a_end: 9, lt: 1, t: 2 }),
          line: { captions: [{ text: "<p>はい</p>", position: { x: 0.5, y: 0.5 } }] },
        }),
      ]),
    );
    assert.ok(clip);
    assert.equal(clip.skipped, 0);
    const [sticky, shape, line] = clip.items;
    assert.deepEqual(
      { type: sticky.type, x: (sticky as { x: number }).x, w: (sticky as { w: number }).w, h: (sticky as { h: number }).h, text: sticky.text, color: sticky.color },
      { type: "sticky", x: -50, w: 100, h: 110, text: "テスト\n2行目", color: "green" },
    );
    assert.equal(shape.type, "diamond");
    assert.equal(shape.text, "A & B");
    assert.equal(shape.color, "white");
    assert.equal(line.type, "connector");
    if (line.type !== "connector") return;
    assert.equal(line.from, sticky.id);
    assert.equal(line.to, shape.id);
    assert.equal(line.fromSide, "right");
    assert.equal(line.toSide, "left");
    assert.equal(line.arrows, "end");
    assert.equal(line.text, "はい");
  });

  test("a free line, a frame with a child, and what can't come", () => {
    const clip = readClip(
      miroHtml([
        widget("frame", { ...at(100, 100), scale: { scale: 1 }, size: { width: 200, height: 200 }, text: "Frame <1>", style: "{}" }),
        widget("text", { _parent: { index: 0 }, _position: { offsetPx: { x: 50, y: 50 }, schema: "parentOffsetPx" }, size: { width: 20, height: 20 }, text: "<p>in</p>" }),
        widget("image", { ...at(0, 0), size: { width: 10, height: 10 } }),
        widget("line", { primary: { point: { x: 0, y: 0 }, widgetIndex: -1 }, secondary: { point: { x: 10, y: 20 }, widgetIndex: -1 }, style: "{}" }),
        { type: 10, items: [0, 1] },
      ]),
    );
    assert.ok(clip);
    assert.equal(clip.skipped, 1);
    const frame = clip.items.find((i) => i.text === "Frame <1>");
    const child = clip.items.find((i) => i.text === "in");
    assert.ok(frame && child && frame.type === "rect" && child.type === "text");
    assert.ok(frame.z < child.z);
    assert.equal(frame.textY, -116);
    // The frame's top left is (0, 0); the child's centre (50, 50) from there.
    assert.deepEqual([child.x, child.y], [40, 40]);
    const line = clip.items.find((i) => i.type === "line");
    assert.ok(line && line.type === "line");
    assert.deepEqual([line.x1, line.y1, line.x2, line.y2, line.arrows], [0, 0, 10, 20, "none"]);
  });

  test("text: paragraphs, lists, entities", () => {
    assert.equal(plainText("<p>a<br>b</p><ul><li>x</li><li>y</li></ul><ol><li>one</li><li>two</li></ol>"), "a\nb\n- x\n- y\n1. one\n2. two");
    assert.equal(plainText("<p>&lt;b&gt; &#x41;&#66;&nbsp;c</p>"), "<b> AB c");
  });

  test("colors by hue", () => {
    assert.equal(nearestColor(0xfff79e, "white"), "yellow");
    assert.equal(nearestColor(0xff9e9e, "white"), "pink");
    assert.equal(nearestColor(0xffb575, "white"), "orange");
    assert.equal(nearestColor(0x86b4f9, "white"), "blue");
    assert.equal(nearestColor(0xb8acfb, "white"), "purple");
    assert.equal(nearestColor(0xf3f5f7, "yellow"), "white");
    assert.equal(nearestColor(0x151515, "yellow"), "gray");
    assert.equal(nearestColor(-1, "white"), "white");
  });
});
