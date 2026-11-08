import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Y from "yjs";
import { readItems, whiteboardFileIds, whiteboardMap } from "../src/lib/whiteboard";
import { GRID, align, distribute, snapMove, snapResize } from "../src/components/whiteboard/snap";
import { TEMPLATES, buildTemplate, templateBounds } from "../src/components/whiteboard/templates";
import { whiteboardSvg } from "../src/components/whiteboard/export";
import { spreadEnds } from "../src/components/whiteboard/geometry";
import type { BoxItem } from "../src/lib/whiteboard";
import { referencedFileIds } from "../src/lib/search-index";

// A whiteboard's snapping, lining up, templates, export, images and links.
//   pnpm --filter web test:unit

function board(items: Record<string, Record<string, unknown>>): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [id, fields] of Object.entries(items)) {
      const item = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(fields)) item.set(key, value);
      whiteboardMap(doc).set(id, item);
    }
  });
  return doc;
}

describe("whiteboard snapping", () => {
  const other = { x: 100, y: 100, w: 100, h: 50 };

  test("a dragged box's edge or center snaps to another's when near, with a guide", () => {
    // Left edge 3 away from the other's left edge.
    const left = snapMove({ x: 103, y: 300, w: 40, h: 40 }, [other], 6, false);
    assert.equal(left.dx, -3);
    assert.equal(left.dy, 0);
    assert.deepEqual(left.guides, [{ axis: "x", at: 100, from: 100, to: 340 }]);
    // Center to center.
    const center = snapMove({ x: 300, y: 104, w: 40, h: 40 }, [other], 6, false);
    assert.equal(center.dy, 1);
    assert.deepEqual(
      center.guides.map((g) => [g.axis, g.at]),
      [["y", 125]],
    );
  });

  test("nothing near: no snap, unless to the grid", () => {
    const free = snapMove({ x: 330, y: 330, w: 40, h: 40 }, [other], 6, false);
    assert.deepEqual([free.dx, free.dy, free.guides], [0, 0, []]);
    const grid = snapMove({ x: 330, y: 330, w: 40, h: 40 }, [other], 6, true);
    assert.equal((330 + grid.dx) % GRID, 0);
    assert.equal((330 + grid.dy) % GRID, 0);
  });

  test("a resized box's right and bottom edges snap; its top left stays", () => {
    const r = snapResize({ x: 0, y: 0, w: 97, h: 30 }, [other], 6, false);
    assert.equal(r.w, 100);
    assert.equal(r.h, 30);
  });
});

describe("whiteboard lining up", () => {
  const boxes = [
    { id: "a", x: 0, y: 0, w: 40, h: 20 },
    { id: "b", x: 100, y: 50, w: 60, h: 40 },
    { id: "c", x: 30, y: 200, w: 20, h: 20 },
  ];

  test("aligned on the edge or center of the rectangle around them", () => {
    assert.deepEqual([...align(boxes, "left").values()].map((p) => p.x), [0, 0, 0]);
    assert.deepEqual([...align(boxes, "right").values()].map((p) => p.x), [120, 100, 140]);
    assert.deepEqual([...align(boxes, "centerX").values()].map((p) => p.x), [60, 50, 70]);
    assert.deepEqual([...align(boxes, "bottom").values()].map((p) => p.y), [200, 180, 200]);
    // Lining up across leaves them where they are down the board.
    assert.deepEqual([...align(boxes, "left").values()].map((p) => p.y), [0, 50, 200]);
  });

  test("aligned on the key box's edge or center, the key box staying put", () => {
    const left = align(boxes, "left", "b");
    assert.deepEqual([...left.values()].map((p) => p.x), [100, 100, 100]);
    const middle = align(boxes, "centerY", "c");
    assert.deepEqual([...middle.values()].map((p) => p.y), [200, 190, 200]);
    // A key that isn't among them: the rectangle around them, as before.
    assert.deepEqual([...align(boxes, "left", "zz").values()].map((p) => p.x), [0, 0, 0]);
  });

  test("spread out with the same gaps, the outer two staying put", () => {
    const across = distribute(boxes, "x");
    // From x 0 to 160: 120 of boxes, so two gaps of 20.
    assert.deepEqual(across.get("a"), { x: 0, y: 0 });
    assert.deepEqual(across.get("c"), { x: 60, y: 200 });
    assert.deepEqual(across.get("b"), { x: 100, y: 50 });
    assert.equal(distribute(boxes.slice(0, 2), "x").size, 0);
  });
});

describe("connector ends meeting a box at one point", () => {
  const box = (id: string, connectorEnds: "spread" | "merge" = "spread"): BoxItem => ({
    id, type: "rect", x: 0, y: 200, w: 100, h: 50, text: "", textX: 0, textY: 0, color: "white", z: 0, src: "", link: "", connectorEnds,
  });
  // Into the top of box c (x 0–100) at x 50: from the left, the right, and straight down.
  const lines = [
    { id: "1", from: "a", to: "c", points: [{ x: -50, y: 100 }, { x: 50, y: 100 }, { x: 50, y: 196 }] },
    { id: "2", from: "b", to: "c", points: [{ x: 150, y: 100 }, { x: 50, y: 100 }, { x: 50, y: 196 }] },
    { id: "3", from: "d", to: "c", points: [{ x: 50, y: 0 }, { x: 50, y: 196 }] },
  ];

  test("spread along the side in the order of their other ends, their last run moving with them", () => {
    const out = spreadEnds(lines, (id) => (id === "c" ? box("c") : undefined));
    assert.deepEqual(out[0].points, [{ x: -50, y: 100 }, { x: 30, y: 100 }, { x: 30, y: 196 }]);
    assert.deepEqual(out[1].points, [{ x: 150, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 196 }]);
    // In the middle: where it was.
    assert.deepEqual(out[2].points, lines[2].points);
    // The lines given aren't changed.
    assert.equal(lines[0].points[2].x, 50);
  });

  test("a run straight across from the other box gets a step halfway", () => {
    const out = spreadEnds([lines[2], { ...lines[2], id: "4", from: "e" }], (id) => (id === "c" ? box("c") : undefined));
    assert.deepEqual(out[0].points, [{ x: 50, y: 0 }, { x: 50, y: 98 }, { x: 40, y: 98 }, { x: 40, y: 196 }]);
    assert.deepEqual(out[1].points.at(-1), { x: 60, y: 196 });
  });

  test("kept together at a box set to merge them", () => {
    const out = spreadEnds(lines, (id) => (id === "c" ? box("c", "merge") : undefined));
    assert.deepEqual(out.map((l) => l.points), lines.map((l) => l.points));
  });
});

describe("whiteboard templates", () => {
  test("every template's connectors join its own boxes, and its text is translated", () => {
    for (const name of TEMPLATES) {
      const template = buildTemplate(name, (key) => `[${key}]`);
      const keys = new Set(template.boxes.map((b) => b.key));
      assert.equal(keys.size, template.boxes.length, name);
      for (const c of template.connectors) assert.ok(keys.has(c.from) && keys.has(c.to), `${name}: ${c.from} → ${c.to}`);
      // Their text is from the translations, under the template's name.
      assert.ok(template.boxes.filter((b) => b.text).every((b) => b.text.startsWith(`[${name}.`)), name);
      const bounds = templateBounds(template);
      assert.ok(bounds.w > 0 && bounds.h > 0 && bounds.w < 2000 && bounds.h < 2000, name);
    }
  });
});

describe("whiteboard images and links", () => {
  test("an image's src is an attachment's URL, or nothing", () => {
    const doc = board({
      a: { type: "image", x: 0, y: 0, w: 100, h: 80, src: "/api/files/abc_123" },
      b: { type: "image", x: 0, y: 0, w: 100, h: 80, src: "https://evil.example/x.png" },
      c: { type: "image", x: 0, y: 0, w: 100, h: 80, src: "javascript:alert(1)" },
      d: { type: "rect", x: 0, y: 0, w: 100, h: 80, src: "/api/files/other" },
    });
    const src = Object.fromEntries(readItems(doc).map((i) => [i.id, "src" in i ? i.src : null]));
    assert.deepEqual(src, { a: "/api/files/abc_123", b: "", c: "", d: "" });
    // Kept from being deleted as unused, and found by search.
    assert.deepEqual(whiteboardFileIds(doc), ["abc_123"]);
    assert.deepEqual(referencedFileIds(doc), ["abc_123"]);
  });

  test("a link is a page id, or nothing", () => {
    const doc = board({
      a: { type: "sticky", x: 0, y: 0, w: 100, h: 100, link: "cmabc123" },
      b: { type: "sticky", x: 0, y: 0, w: 100, h: 100, link: "../admin" },
      c: { type: "sticky", x: 0, y: 0, w: 100, h: 100, link: "https://example.com" },
    });
    const link = Object.fromEntries(readItems(doc).map((i) => [i.id, "link" in i ? i.link : null]));
    assert.deepEqual(link, { a: "cmabc123", b: "", c: "" });
  });
});

describe("whiteboard export", () => {
  const colors = {
    items: { yellow: "#ff0", orange: "#fa0", pink: "#f9c", purple: "#ccf", blue: "#9cf", green: "#9f9", gray: "#ddd", white: "#fff" },
    board: "#fafafa",
    ink: "#111",
    line: "#555",
    muted: "#888",
  };

  test("the board as SVG: shapes, connectors and text, the text escaped", () => {
    const doc = board({
      a: { type: "sticky", x: 0, y: 0, w: 100, h: 100, text: "<script>alert(1)</script> & co", z: 1 },
      b: { type: "ellipse", x: 300, y: 0, w: 100, h: 60, text: "- one\n- two", z: 2 },
      c: { type: "connector", from: "a", to: "b", text: "next", z: 3 },
    });
    const { svg, width, height } = whiteboardSvg(readItems(doc), colors);
    assert.ok(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""));
    assert.ok(!svg.includes("<script>"), "text is escaped");
    assert.ok(svg.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co"));
    assert.ok(svg.includes("<ellipse"));
    assert.ok(svg.includes("<li>one</li><li>two</li>"));
    assert.ok(svg.includes(">next</div>"));
    assert.ok(svg.includes('marker-end="url(#wb-arrow)"'));
    // The items and a margin around them.
    assert.equal(width, 400 + 80);
    assert.equal(height, 100 + 80);
  });

  test("connectors and lines in their strokes; an unknown stroke is a normal line", () => {
    const doc = board({
      a: { type: "rect", x: 0, y: 0, w: 100, h: 60, z: 1 },
      b: { type: "rect", x: 300, y: 0, w: 100, h: 60, z: 2 },
      c: { type: "connector", from: "a", to: "b", stroke: "double", z: 3 },
      d: { type: "line", x1: 0, y1: 200, x2: 300, y2: 200, stroke: "dashed", arrows: "end", z: 4 },
      e: { type: "line", x1: 0, y1: 300, x2: 300, y2: 300, stroke: "zigzag", z: 5 },
    });
    const items = readItems(doc);
    assert.deepEqual(
      items.flatMap((i) => ("stroke" in i ? [[i.id, i.stroke]] : [])),
      [["c", "double"], ["d", "dashed"], ["e", "solid"]],
    );
    const { svg } = whiteboardSvg(items, colors);
    // Double: a wide line, then a board-colored one down its middle.
    assert.ok(svg.includes('stroke="#555" stroke-width="6"/><path d="M'));
    assert.ok(svg.includes('stroke="#fafafa" stroke-width="2"/>'));
    // Its arrowhead on top of both.
    assert.ok(svg.includes('stroke="none" marker-end="url(#wb-arrow-large)"/>'));
    assert.ok(svg.includes('stroke-width="2" stroke-dasharray="8 6" marker-end="url(#wb-arrow)"'));
  });

  test("images are put in from the given data, or drawn as a gray box", () => {
    const doc = board({ a: { type: "image", x: 0, y: 0, w: 100, h: 80, src: "/api/files/abc" } });
    const withData = whiteboardSvg(readItems(doc), colors, new Map([["/api/files/abc", "data:image/png;base64,AAAA"]])).svg;
    assert.ok(withData.includes('href="data:image/png;base64,AAAA"'));
    const without = whiteboardSvg(readItems(doc), colors).svg;
    assert.ok(!without.includes("<image") && without.includes('fill="#ddd"'));
  });
});
