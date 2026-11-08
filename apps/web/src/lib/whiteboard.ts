import * as Y from "yjs";

// A whiteboard page (Page.kind = WHITEBOARD) keeps its canvas in the page's
// Yjs document, next to the title: Y.Map(WHITEBOARD_FIELD) of items by id,
// each a Y.Map of the fields below. The BlockNote fragment stays empty, so
// an editor that doesn't know whiteboards never touches the canvas.
// Used by the browser and the collab server: only Yjs as a dependency.
export const WHITEBOARD_FIELD = "whiteboard";

export const ITEM_TYPES = ["sticky", "rect", "ellipse", "diamond", "text", "image", "connector", "line"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
// The items with a box (position and size). Connectors attach to these.
export const BOX_TYPES = ["sticky", "rect", "ellipse", "diamond", "text", "image"] as const;
// The boxes with text, which can be changed into one another.
export const SHAPE_TYPES = ["sticky", "rect", "ellipse", "diamond", "text"] as const;
export const isShapeType = (type: string): type is (typeof SHAPE_TYPES)[number] => (SHAPE_TYPES as readonly string[]).includes(type);

// Colors are names, shown through CSS variables (--color-wb-<name>).
export const ITEM_COLORS = ["yellow", "orange", "pink", "purple", "blue", "green", "gray", "white"] as const;
export type ItemColor = (typeof ITEM_COLORS)[number];

// Which ends of a connector or line have an arrowhead (a connector's start
// is the box it was drawn from). The others end plainly.
export const ARROW_ENDS = ["end", "both", "start", "none"] as const;
export type ArrowEnds = (typeof ARROW_ENDS)[number];

// How a connector runs: straight from box to box, or in straight lines
// turning at right angles (rounded corners).
export const ROUTES = ["straight", "elbow"] as const;
export type Route = (typeof ROUTES)[number];

// How a connector or line is drawn: a plain line, a thick one, dashed, or
// two thin lines side by side. Missing (as before it could be chosen): "solid".
export const STROKES = ["solid", "bold", "dashed", "double"] as const;
export type Stroke = (typeof STROKES)[number];

// Where the ends of several connectors meet a box at the same point: spread
// a little apart along its side, or kept on top of each other. Missing:
// "spread".
export const CONNECTOR_ENDS = ["spread", "merge"] as const;
export type ConnectorEnds = (typeof CONNECTOR_ENDS)[number];

// The side of a box an elbow connector leaves or enters by: where its end
// was dropped. Null: chosen by itself.
export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

export type BoxItem = {
  id: string;
  type: (typeof BOX_TYPES)[number];
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  // How far the text is moved from where it would be (it may go outside
  // the box). Missing: 0.
  textX: number;
  textY: number;
  color: ItemColor;
  // Stacking order (higher is in front).
  z: number;
  // An image's file: an attachment of the page, "/api/files/<id>" (without
  // the base path, as in documents). "" for the other boxes, or one that
  // isn't an attachment's URL.
  src: string;
  // The id of a page the box links to ("" for none). Opened with the
  // viewer's own access: nothing about the page is kept here but its id.
  link: string;
  connectorEnds: ConnectorEnds;
};

// The text fields of an item: a connector has text halfway along it and by
// each end; the others have only `text`.
export const TEXT_FIELDS = ["text", "startText", "endText"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

// A line with an arrow from one box to another; it follows them when they move.
export type ConnectorItem = {
  id: string;
  type: "connector";
  from: string;
  to: string;
  // Missing on connectors from before it could be chosen: "end".
  arrows: ArrowEnds;
  // Missing on connectors from before it could be chosen: "straight".
  route: Route;
  stroke: Stroke;
  // The sides of its boxes an elbow connector runs from and to (missing: null).
  fromSide: Side | null;
  toSide: Side | null;
  // Halfway along, and by its start and end (missing: "").
  text: string;
  startText: string;
  endText: string;
  color: ItemColor;
  z: number;
};

// A straight line drawn on the board, attached to nothing.
export type LineItem = {
  id: string;
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Missing: "none".
  arrows: ArrowEnds;
  stroke: Stroke;
  // Always empty (a line has no text), for the code that reads every item's.
  text: string;
  color: ItemColor;
  z: number;
};

export type WhiteboardItem = BoxItem | ConnectorItem | LineItem;

export const isBox = (item: WhiteboardItem | undefined): item is BoxItem =>
  !!item && (BOX_TYPES as readonly string[]).includes(item.type);

export const MIN_SIZE = 16;
export const MAX_SIZE = 20_000;
// Coordinates are kept within this distance of the origin.
export const MAX_COORD = 1_000_000;
export const MAX_ITEMS = 5_000;
export const MAX_TEXT_LENGTH = 5_000;

// At 100%. A text item is one line high.
export const DEFAULT_SIZE: Record<BoxItem["type"], { w: number; h: number }> = {
  sticky: { w: 100, h: 100 },
  rect: { w: 120, h: 70 },
  ellipse: { w: 100, h: 70 },
  diamond: { w: 120, h: 80 },
  text: { w: 120, h: 28 },
  image: { w: 240, h: 160 },
};

export const DEFAULT_COLOR: Record<ItemType, ItemColor> = {
  sticky: "yellow",
  rect: "white",
  ellipse: "white",
  diamond: "white",
  text: "white",
  image: "white",
  connector: "gray",
  line: "gray",
};

export function whiteboardMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(WHITEBOARD_FIELD);
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT_LENGTH) : "");

// An attachment's URL as kept in a document; anything else isn't shown.
export const FILE_URL = /^\/api\/files\/[A-Za-z0-9_-]{1,64}$/;
// A page id (cuid); anything else isn't a link.
export const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const matching = (v: unknown, pattern: RegExp) => (typeof v === "string" && pattern.test(v) ? v : "");

// One item, checked: the document is shared by everyone who can edit the
// page, so anything in it may be malformed. Null for what can't be shown.
export function readItem(id: string, map: Y.Map<unknown>): WhiteboardItem | null {
  const type = map.get("type");
  if (!(ITEM_TYPES as readonly unknown[]).includes(type)) return null;
  const rawColor = map.get("color");
  const color = (ITEM_COLORS as readonly unknown[]).includes(rawColor)
    ? (rawColor as ItemColor)
    : DEFAULT_COLOR[type as ItemType];
  const z = num(map.get("z"), 0);
  const text = str(map.get("text"));
  const rawStroke = map.get("stroke");
  const stroke = (STROKES as readonly unknown[]).includes(rawStroke) ? (rawStroke as Stroke) : "solid";
  if (type === "connector") {
    const from = map.get("from");
    const to = map.get("to");
    if (typeof from !== "string" || typeof to !== "string" || from === to) return null;
    const rawArrows = map.get("arrows");
    const arrows = (ARROW_ENDS as readonly unknown[]).includes(rawArrows) ? (rawArrows as ArrowEnds) : "end";
    const rawRoute = map.get("route");
    const route = (ROUTES as readonly unknown[]).includes(rawRoute) ? (rawRoute as Route) : "straight";
    const side = (key: string) => {
      const value = map.get(key);
      return (SIDES as readonly unknown[]).includes(value) ? (value as Side) : null;
    };
    return {
      id,
      type,
      from,
      to,
      arrows,
      route,
      stroke,
      fromSide: side("fromSide"),
      toSide: side("toSide"),
      text,
      startText: str(map.get("startText")),
      endText: str(map.get("endText")),
      color,
      z,
    };
  }
  const coord = (key: string) => clamp(num(map.get(key), 0), -MAX_COORD, MAX_COORD);
  if (type === "line") {
    const rawArrows = map.get("arrows");
    const arrows = (ARROW_ENDS as readonly unknown[]).includes(rawArrows) ? (rawArrows as ArrowEnds) : "none";
    return { id, type, x1: coord("x1"), y1: coord("y1"), x2: coord("x2"), y2: coord("y2"), arrows, stroke, text: "", color, z };
  }
  return {
    id,
    type: type as BoxItem["type"],
    x: coord("x"),
    y: coord("y"),
    w: clamp(num(map.get("w"), MIN_SIZE), MIN_SIZE, MAX_SIZE),
    h: clamp(num(map.get("h"), MIN_SIZE), MIN_SIZE, MAX_SIZE),
    text,
    textX: clamp(num(map.get("textX"), 0), -MAX_SIZE, MAX_SIZE),
    textY: clamp(num(map.get("textY"), 0), -MAX_SIZE, MAX_SIZE),
    color,
    z,
    src: type === "image" ? matching(map.get("src"), FILE_URL) : "",
    link: matching(map.get("link"), PAGE_ID),
    connectorEnds: map.get("connectorEnds") === "merge" ? "merge" : "spread",
  };
}

// The attachments the board shows (its images), as "/api/files/<id>" ids.
export function whiteboardFileIds(doc: Y.Doc): string[] {
  const ids = new Set<string>();
  for (const item of readItems(doc)) if (isBox(item) && item.src) ids.add(item.src.slice("/api/files/".length));
  return [...ids];
}

// Every item that can be shown, back to front. Connectors whose ends are
// gone are left out (they come back with them, e.g. on undo).
export function readItems(doc: Y.Doc): WhiteboardItem[] {
  const items: WhiteboardItem[] = [];
  for (const [id, value] of whiteboardMap(doc)) {
    if (!(value instanceof Y.Map)) continue;
    const item = readItem(id, value);
    if (item) items.push(item);
  }
  const boxes = new Set(items.filter(isBox).map((i) => i.id));
  return items
    .filter((i) => i.type !== "connector" || (boxes.has(i.from) && boxes.has(i.to)))
    .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

export function hasWhiteboardContent(doc: Y.Doc): boolean {
  return whiteboardMap(doc).size > 0;
}

// The board's text for search: one item per line, top to bottom, left to
// right (connectors after the boxes).
export function whiteboardText(doc: Y.Doc): string {
  const items = readItems(doc);
  const boxes = items.filter(isBox).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [
    ...boxes.map((b) => b.text),
    ...items.flatMap((i) => (i.type === "connector" ? [i.startText, i.text, i.endText] : [])),
  ]
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.join("\n");
}

// Copies the board into another document as fresh Yjs data (a public page's
// copy, a restored or masked version): only what is there now, none of the
// source's history. `mapText` changes each string value on the way (masking).
// Call inside a transaction on `target`.
export function copyWhiteboard(source: Y.Doc, target: Y.Doc, mapText: (s: string) => string = (s) => s): void {
  const to = whiteboardMap(target);
  for (const key of [...to.keys()]) to.delete(key);
  for (const [id, value] of whiteboardMap(source)) {
    if (!(value instanceof Y.Map)) continue;
    const item = new Y.Map<unknown>();
    for (const [key, field] of value) {
      item.set(key, typeof field === "string" && (TEXT_FIELDS as readonly string[]).includes(key) ? mapText(field) : field);
    }
    to.set(id, item);
  }
}
