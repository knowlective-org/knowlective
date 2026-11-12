import * as Y from "yjs";
import {
  type ArrowEnds,
  type BoxItem,
  type ItemColor,
  MAX_ITEMS,
  MAX_TEXT_LENGTH,
  type Side,
  type WhiteboardItem,
  isBox,
  readItems,
  whiteboardMap,
} from "@/lib/whiteboard";

// Copying and pasting on a whiteboard (no DOM, so it can be tested in Node).
//
// A copy puts the items on the clipboard as HTML: an element whose
// CLIP_ATTR holds the items (JSON, in Base64), around their text for other
// apps; and the text alone as plain text. Pasted back on a board, the items
// are read from the attribute and checked like the document's own items
// (readItem()), since anyone could have put anything there.
//
// What Miro copies is read too: its HTML has a `data-meta` attribute with
// "(miro-data-v1)<Base64>(/miro-data-v1)", whose bytes are JSON with 59 added
// to each byte. Miro doesn't document it (observed: an array of objects in
// `data.objects`, each `widgetData` with a `type` and its `json`; positions
// are centres; connectors refer to other objects by their index). Sticky
// notes, shapes, texts and connectors (and lines) become the board's own;
// frames become a rectangle with their title above; images, drawings and
// the rest are left out (counted in `skipped`).

export const CLIP_ATTR = "data-knowlective-whiteboard";

export type Clip = {
  // The page the items were copied on ("" from Miro): images are attachments
  // of that page.
  page: string;
  // Checked; connectors only between the clip's own boxes.
  items: WhiteboardItem[];
  // From Miro: the objects that couldn't be brought over.
  skipped: number;
};

export type Bounds = { x: number; y: number; w: number; h: number };

// The selected boxes and lines, and the connectors between two of them, back
// to front.
export function clipItems(items: WhiteboardItem[], selected: Set<string>): WhiteboardItem[] {
  const chosen = new Set(items.filter((i) => i.type !== "connector" && selected.has(i.id)).map((i) => i.id));
  return items.filter((i) => chosen.has(i.id) || (i.type === "connector" && chosen.has(i.from) && chosen.has(i.to)));
}

// The text of the items, for other apps: the boxes' from top to bottom, left
// to right, one per line.
export function clipText(items: WhiteboardItem[]): string {
  return items
    .filter(isBox)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n");
}

export function clipHtml(page: string, items: WhiteboardItem[]): string {
  const json = JSON.stringify({ v: 1, page, items });
  const lines = clipText(items)
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  return `<div ${CLIP_ATTR}="${toBase64(new TextEncoder().encode(json))}">${lines}</div>`;
}

// What was copied on a board, or in Miro; null for anything else.
export function readClip(html: string): Clip | null {
  return readOwn(html) ?? readMiro(html);
}

// The rectangle around the boxes and lines (connectors follow their boxes).
export function clipBounds(items: WhiteboardItem[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of items) {
    if (isBox(i)) {
      minX = Math.min(minX, i.x);
      minY = Math.min(minY, i.y);
      maxX = Math.max(maxX, i.x + i.w);
      maxY = Math.max(maxY, i.y + i.h);
    } else if (i.type === "line") {
      minX = Math.min(minX, i.x1, i.x2);
      minY = Math.min(minY, i.y1, i.y2);
      maxX = Math.max(maxX, i.x1, i.x2);
      maxY = Math.max(maxY, i.y1, i.y2);
    }
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function readOwn(html: string): Clip | null {
  const match = new RegExp(`${CLIP_ATTR}="([A-Za-z0-9+/=]+)"`).exec(html);
  if (!match) return null;
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64(match[1])));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { page, items } = data as { page?: unknown; items?: unknown };
  if (!Array.isArray(items)) return null;
  const raw = new Map<string, Record<string, unknown>>();
  for (const item of items.slice(0, MAX_ITEMS)) {
    if (!item || typeof item !== "object") continue;
    const { id, ...fields } = item as Record<string, unknown>;
    if (typeof id === "string" && id) raw.set(id, fields);
  }
  return { page: typeof page === "string" ? page : "", items: checked(raw), skipped: 0 };
}

// The items as the board reads its own (lib/whiteboard.ts): through a
// throwaway document, so the same checks apply.
function checked(raw: Map<string, Record<string, unknown>>): WhiteboardItem[] {
  const doc = new Y.Doc();
  const map = whiteboardMap(doc);
  doc.transact(() => {
    for (const [id, fields] of raw) {
      const item = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === "string" || typeof value === "number") item.set(key, value);
      }
      map.set(id, item);
    }
  });
  return readItems(doc);
}

// --- Miro ---

type MiroObject = { type?: unknown; items?: unknown; widgetData?: { type?: unknown; json?: Record<string, unknown> } };
type MiroEnd = { point?: { x?: unknown; y?: unknown }; widgetIndex?: unknown };

function readMiro(html: string): Clip | null {
  const match = /\(miro-data-v1\)([A-Za-z0-9+/=\s]+)\(\/miro-data-v1\)/.exec(html);
  if (!match) return null;
  let data: unknown;
  try {
    const bytes = fromBase64(match[1].replace(/\s+/g, ""));
    for (let i = 0; i < bytes.length; i++) bytes[i] = (bytes[i] + 197) & 255;
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const objects = (data as { data?: { objects?: unknown } } | null)?.data?.objects;
  if (!Array.isArray(objects)) return null;
  return fromMiro(objects.slice(0, MAX_ITEMS) as MiroObject[]);
}

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function style(json: Record<string, unknown>): Record<string, unknown> {
  if (typeof json.style !== "string") return obj(json.style);
  try {
    return obj(JSON.parse(json.style));
  } catch {
    return {};
  }
}

function fromMiro(objects: MiroObject[]): Clip {
  const raw = new Map<string, Record<string, unknown>>();
  const boxes = new Map<number, { id: string; x: number; y: number; w: number; h: number }>();
  let skipped = 0;
  let z = 0;
  const kind = (o: MiroObject) => (typeof o?.widgetData?.type === "string" ? o.widgetData.type : "");

  // A box's centre on the board: inside a frame, measured from the frame's
  // top left corner.
  const centre = (index: number, seen = new Set<number>()): { x: number; y: number } | null => {
    const json = obj(objects[index]?.widgetData?.json);
    const position = obj(json._position);
    const offset = obj(position.offsetPx);
    const x = num(offset.x, NaN);
    const y = num(offset.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (position.schema !== "parentOffsetPx") return { x, y };
    const parent = num(obj(json._parent).index, -1);
    if (parent < 0 || seen.has(parent)) return null;
    seen.add(index);
    const frame = centre(parent, seen);
    const size = sizeOf(obj(objects[parent]?.widgetData?.json));
    return frame && size ? { x: frame.x - size.w / 2 + x, y: frame.y - size.h / 2 + y } : null;
  };

  // Frames first, so they stay behind what's in them.
  const order = objects.map((_, i) => i).sort((a, b) => Number(kind(objects[b]) === "frame") - Number(kind(objects[a]) === "frame"));
  for (const index of order) {
    const o = objects[index];
    const type = kind(o);
    if (o?.type === 10 && !o.widgetData) continue; // a group: its members come on their own
    if (type === "line") continue; // after the boxes
    const json = obj(o?.widgetData?.json);
    const s = style(json);
    const box = boxType(type, json, s);
    const at = centre(index);
    const size = sizeOf(json);
    if (!box || !at || !size) {
      skipped++;
      continue;
    }
    const id = `m${index}`;
    const text = type === "frame" ? plainText(typeof json.text === "string" ? escapeHtml(json.text) : "") : plainText(json.text);
    const fields: Record<string, unknown> = {
      type: box.type,
      x: Math.round(at.x - size.w / 2),
      y: Math.round(at.y - size.h / 2),
      w: Math.round(size.w),
      h: Math.round(size.h),
      text,
      color: box.color,
      z: ++z,
    };
    // A frame's title above its top edge.
    if (type === "frame" && text) fields.textY = -Math.round(size.h / 2) - 16;
    raw.set(id, fields);
    boxes.set(index, { id, x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h });
  }

  objects.forEach((o, index) => {
    if (kind(o) !== "line") return;
    const json = obj(o.widgetData?.json);
    const s = style(json);
    const arrows = arrowEnds(num(s.a_start), num(s.a_end));
    const stroke = num(s.t, 2) >= 4 ? "bold" : "solid";
    const ends = [json.primary, json.secondary].map((end) => {
      const e = obj(end) as MiroEnd;
      const point = obj(e.point);
      const box = boxes.get(num(e.widgetIndex, -1));
      const px = num(point.x, NaN);
      const py = num(point.y, NaN);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
      return box ? { box, side: sideAt(px, py), x: box.x + px * box.w, y: box.y + py * box.h } : { box: null, side: null, x: px, y: py };
    });
    const [a, b] = ends;
    if (!a || !b) {
      skipped++;
      return;
    }
    if (a.box && b.box && a.box.id !== b.box.id) {
      const captions = Array.isArray(obj(json.line).captions) ? (obj(json.line).captions as unknown[]) : [];
      const labels: Record<string, string> = {};
      for (const caption of captions) {
        const c = obj(caption);
        const text = plainText(c.text);
        if (!text) continue;
        const along = num(obj(c.position).x, 0.5);
        const field = along < 0.25 ? "startText" : along > 0.75 ? "endText" : "text";
        labels[field] = labels[field] ? `${labels[field]} ${text}` : text;
      }
      raw.set(`m${index}`, {
        type: "connector",
        from: a.box.id,
        to: b.box.id,
        arrows,
        // Miro's `lt` (observed 0, 1, 2) isn't documented: 0 is taken as
        // straight, the others (bent ones) as elbow.
        route: num(s.lt) === 0 ? "straight" : "elbow",
        stroke,
        ...(a.side ? { fromSide: a.side } : {}),
        ...(b.side ? { toSide: b.side } : {}),
        text: "",
        ...labels,
        color: "gray",
        z: ++z,
      });
      return;
    }
    // Not between two boxes: a line where its ends are.
    raw.set(`m${index}`, { type: "line", x1: Math.round(a.x), y1: Math.round(a.y), x2: Math.round(b.x), y2: Math.round(b.y), arrows, stroke, color: "gray", z: ++z });
  });

  return { page: "", items: checked(raw), skipped };
}

function sizeOf(json: Record<string, unknown>): { w: number; h: number } | null {
  const size = obj(json.size);
  const scale = num(obj(json.scale).scale, 1) || 1;
  const w = num(size.width, num(json.width, NaN)) * scale;
  const h = num(size.height, num(json.height, NaN)) * scale;
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

function boxType(type: string, json: Record<string, unknown>, s: Record<string, unknown>): { type: BoxItem["type"]; color: ItemColor } | null {
  if (type === "sticker") return { type: "sticky", color: nearestColor(num(s.sbc, 0xfff79e), "yellow") };
  if (type === "text") return { type: "text", color: "white" };
  if (type === "frame") return { type: "rect", color: nearestColor(num(s.bc, -1), "white") };
  if (type === "shape") {
    const shape = String(json.shape ?? s.st ?? "");
    // Observed: 3 rectangle, 7 rounded rectangle, 4 ellipse, 8 rhombus;
    // anything else is drawn as a rectangle.
    const kind = shape === "4" ? "ellipse" : shape === "8" ? "diamond" : "rect";
    return { type: kind, color: nearestColor(num(s.bc, -1), "white") };
  }
  return null;
}

function arrowEnds(start: number, end: number): ArrowEnds {
  if (start && end) return "both";
  if (start) return "start";
  if (end) return "end";
  return "none";
}

// The middle of a side, as Miro gives a point on a box (0 to 1 each way).
function sideAt(x: number, y: number): Side | null {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  if (near(y, 0.5) && near(x, 0)) return "left";
  if (near(y, 0.5) && near(x, 1)) return "right";
  if (near(x, 0.5) && near(y, 0)) return "top";
  if (near(x, 0.5) && near(y, 1)) return "bottom";
  return null;
}

// The board's color nearest to a Miro color (RGB as a number; -1 is none),
// by hue: the board's are pale, Miro's often strong.
export function nearestColor(rgb: number, none: ItemColor): ItemColor {
  if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff) return none;
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  if (sat < 0.25 || max - min < 0.08) return light > 0.93 ? "white" : "gray";
  const d = max - min;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 290) return "pink";
  if (hue < 42) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 170) return "green";
  if (hue < 245) return "blue";
  return "purple";
}

// Miro's text is HTML: one line per paragraph, list items as the board's
// lists ("- ", "1. "), no markup.
export function plainText(html: unknown): string {
  if (typeof html !== "string") return "";
  // In document order: each list numbers its own items.
  const lists: number[] = [];
  const text = html.replace(/<(\/?)([a-z0-9]+)[^>]*>/gi, (_, close: string, name: string) => {
    const tag = name.toLowerCase();
    if (tag === "ol" || tag === "ul") {
      if (close) lists.pop();
      else lists.push(tag === "ol" ? 0 : -1);
      return "\n";
    }
    if (tag === "li" && !close) {
      const last = lists.length - 1;
      if (last < 0 || lists[last] < 0) return "\n- ";
      return `\n${++lists[last]}. `;
    }
    if (tag === "br" || (close && /^(p|div|h[1-6])$/.test(tag))) return "\n";
    return "";
  });
  return decodeEntities(text)
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return named[code.toLowerCase()] ?? all;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(base64: string): Uint8Array {
  const s = atob(base64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
