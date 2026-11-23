import assert from "node:assert/strict";
import { test } from "node:test";
import { strLit } from "@blocknote/xl-pdf-exporter";
import { presentationTypst as build, type PdfSlide, type TextFragment, typstColor } from "../src/components/presentation/slide-pdf";

const fragment = (over: Partial<TextFragment> = {}): TextFragment => ({
  text: "text",
  x: 100,
  y: 200,
  w: 50,
  h: 20,
  size: 16,
  color: "rgb(31, 35, 40)",
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  highlight: null,
  ...over,
});
const presentationTypst = (slides: PdfSlide[], o: Parameters<typeof build>[1]) => build(slides, o, strLit);
const options = { title: "Deck", lang: "ja", board: "#ffffff", ink: "#1f2328", position: "right" as const };

test("CSS colors become Typst colors, and nothing else gets through", () => {
  assert.equal(typstColor("rgb(255, 0, 16)"), 'rgb("#ff0010")');
  assert.equal(typstColor("rgba(1, 2, 3, 0.5)"), 'rgb("#010203")');
  assert.equal(typstColor("#AABBCC"), 'rgb("#aabbcc")');
  assert.equal(typstColor("rgba(0, 0, 0, 0)"), null);
  for (const bad of ['red"); #panic("x', "rgb(999, 0, 0)", "url(x)", "var(--x)"]) assert.equal(typstColor(bad), null);
});

test("a person's text is a string, never Typst markup", () => {
  const evil = '"); #panic("x") #read("/etc/passwd") \\';
  const source = presentationTypst([{ layers: [{ asset: null, fragments: [fragment({ text: evil })] }], number: null }], {
    ...options,
    title: evil,
  });
  assert.ok(!/(?<!\\)"\); #panic/.test(source));
  assert.ok(source.includes('\\"); #panic(\\"x\\")'));
});

test("one page per slide, an empty one included", () => {
  const source = presentationTypst(
    [
      { layers: [{ asset: "/assets/a.svg", fragments: [fragment()] }], number: 1 },
      { layers: [], number: null },
    ],
    options,
  );
  assert.equal(source.split("#pagebreak()").length, 2);
  assert.ok(source.includes('image("/assets/a.svg"'));
  assert.ok(source.includes("width: 960pt, height: 540pt"));
  assert.ok(source.includes('"1"'));
});

test("text sits where the browser laid it out, without added spacing", () => {
  const source = presentationTypst([{ layers: [{ asset: null, fragments: [fragment({ bold: true })] }], number: null }], options);
  assert.ok(source.includes("dx: 50pt, dy: 100pt"));
  assert.ok(source.includes("weight: 700"));
  assert.ok(source.includes("cjk-latin-spacing: none"));
});

test("styles are drawn", () => {
  const source = presentationTypst(
    [
      {
        layers: [{ asset: null, fragments: [fragment({ italic: true, underline: true, strike: true, highlight: "rgb(255, 225, 77)" })] }],
        number: null,
      },
    ],
    options,
  );
  assert.ok(source.includes("skew("));
  assert.equal(source.match(/line\(length/g)?.length, 2);
  assert.ok(source.includes('fill: rgb("#ffe14d")'));
});
