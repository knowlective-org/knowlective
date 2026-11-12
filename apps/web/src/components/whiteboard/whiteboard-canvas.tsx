"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import {
  ARROW_ENDS,
  type ArrowEnds,
  type BoxItem,
  CONNECTOR_ENDS,
  type ConnectorEnds,
  type ConnectorItem,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
  ITEM_COLORS,
  type ItemColor,
  type LineItem,
  MAX_COORD,
  MAX_ITEMS,
  MAX_SIZE,
  MAX_TEXT_LENGTH,
  MIN_SIZE,
  ROUTES,
  type Route,
  SHAPE_TYPES,
  SIDES,
  STROKES,
  type Side,
  type Stroke,
  type TextField,
  type WhiteboardItem,
  isBox,
  isShapeType,
  readItems,
  whiteboardMap,
} from "@/lib/whiteboard";
import { getUploadPolicy } from "@/app/(app)/actions";
import { adoptPageFiles } from "@/app/(app)/pages/[pageId]/file-actions";
import { showAlert } from "@/components/dialog";
import { showNotice } from "@/components/notice";
import { PagePickerDialog } from "@/components/page-picker-dialog";
import { resolveAppUrl } from "@/lib/base-path";
import { beginSaving } from "@/lib/saving-status";
import { UploadError, postFile } from "@/lib/upload-file";
import { isUploadAllowed, uploadRefusedMessage } from "@/lib/upload-types";
import { type Clip, clipBounds, clipHtml, clipItems, clipText, readClip } from "./clipboard";
import {
  type Camera,
  type Point,
  type Rect,
  boundsOf,
  connectorPoints,
  fitCamera,
  fractionAlong,
  hopCrossings,
  intersects,
  lineEnds,
  lineRect,
  endLabelPlace,
  midpointOf,
  rectFrom,
  routePath,
  sideToward,
  snapAngle,
  spreadEnds,
  straightened,
  stepZoom,
  toScreen,
  toWorld,
  zoomAt,
} from "./geometry";
import { enterInList, parseRichText, toggleList } from "./rich-text";
import { Icon, type IconName } from "@/components/icons";
import { ARROW_HEADS, STROKE_DRAW } from "./stroke";
import { ALIGNMENTS, type Alignment, type Guide, align, distribute, snapMove, snapResize } from "./snap";
import { TEMPLATES, type TemplateName, buildTemplate, templateBounds } from "./templates";
import styles from "./whiteboard.module.css";

type Tool = "select" | "hand" | WhiteboardItem["type"];

// What a pointer drag is doing, kept in a ref (it changes on every move).
type Gesture =
  | { kind: "pan"; start: Point; camera: Camera }
  | {
      kind: "move";
      start: Point;
      // Where the moving boxes (top left) and lines (ends) started.
      origins: Map<string, Point>;
      lineOrigins: Map<string, LineEnds>;
      moved: boolean;
      clicked: string;
      wasSelected: boolean;
      // Alt held when the drag began: the moving items are copies, each
      // with the item it was copied from.
      copiedFrom?: Map<string, string>;
    }
  | { kind: "resize"; id: string; start: Point; origin: { w: number; h: number } }
  | { kind: "marquee"; start: Point; base: Set<string> }
  // From a box's dot (its side), or anywhere on it with the connector tool.
  | { kind: "connect"; from: string; fromSide: Side | null }
  // A connector's end dragged to another box; `fixed` is the box at its other end.
  | { kind: "reconnect"; id: string; end: "from" | "to"; fixed: string }
  // A rectangle or ellipse being drawn: made once the pointer has moved.
  | { kind: "draw"; type: "rect" | "ellipse" | "diamond"; start: Point; id: string | null }
  // A box's text being moved (its offset from where it would be).
  | { kind: "moveText"; id: string; start: Point; origin: Point }
  // A line being drawn (likewise), or one of a line's ends dragged.
  | { kind: "drawLine"; start: Point; id: string | null }
  | { kind: "lineEnd"; id: string; end: "1" | "2"; fixed: Point }
  | { kind: "pinch"; distance: number; mid: Point; camera: Camera };

type LineEnds = { x1: number; y1: number; x2: number; y2: number };

type RemoteCursor = { clientId: number; name: string; color: string; x: number; y: number };

// Whether the connector links box `a` at side `aSide` to box `b` at side
// `bSide`, either way round. Two boxes get one connector per pair of sides
// at most: more would lie on top of each other; through other sides, they
// run apart. No side chosen (null: the connector picks one itself) may be
// any side, so it matches every side.
const sameSide = (s: Side | null, t: Side | null) => s === null || t === null || s === t;
const linksBoxes = (c: ConnectorItem, a: string, aSide: Side | null, b: string, bSide: Side | null) =>
  (c.from === a && c.to === b && sameSide(c.fromSide, aSide) && sameSide(c.toSide, bSide)) ||
  (c.from === b && c.to === a && sameSide(c.fromSide, bSide) && sameSide(c.toSide, aSide));

// The pickers for a connector's or line's arrowheads (ARROW_ENDS), and a
// connector's route (ROUTES).
const ARROW_ICONS: Record<ArrowEnds, IconName> = { end: "arrowEnd", both: "arrowBoth", start: "arrowStart", none: "arrowNone" };
const ROUTE_ICONS: Record<Route, IconName> = { straight: "routeStraight", elbow: "routeElbow" };
const STROKE_ICONS: Record<Stroke, IconName> = { solid: "strokeSolid", bold: "strokeBold", dashed: "strokeDashed", double: "strokeDouble" };
const ENDS_ICONS: Record<ConnectorEnds, IconName> = { spread: "endsSpread", merge: "endsMerge" };

// A line's length when it's made with a click (no drag).
const DEFAULT_LINE_LENGTH = 120;

// How near (on screen) an edge or a center must come to another's to snap to it.
const SNAP_PX = 6;
// Snapping to the board's dots (when nothing else is near): each viewer's own
// choice, kept in their browser.
const GRID_KEY = "knowlective-whiteboard-grid";

// Images put on a board: the types /api/files shows (others are downloaded,
// not shown), at most this big (on the longer side) when put in.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const MAX_IMAGE_SIDE = 480;

// The align and distribute buttons' icons.
const ALIGN_ICONS: Record<Alignment | "x" | "y", IconName> = {
  left: "alignLeft",
  centerX: "alignCenterX",
  right: "alignRight",
  top: "alignTop",
  centerY: "alignCenterY",
  bottom: "alignBottom",
  x: "distributeX",
  y: "distributeY",
};

function readGridSnap(): boolean {
  try {
    return window.localStorage.getItem(GRID_KEY) === "true";
  } catch {
    return false;
  }
}

// An image file's size in pixels (the usual image size if it can't be read).
async function naturalSize(file: File): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 && image.naturalHeight > 0 ? { w: image.naturalWidth, h: image.naturalHeight } : DEFAULT_SIZE.image;
  } catch {
    return DEFAULT_SIZE.image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// How much Ctrl/⌘ + scroll zooms: a mouse wheel's notch (lines, or 50px
// and more at a time) by one small step; a trackpad's pinch (small pixel
// steps, many of them) by its amount.
const WHEEL_STEP = 1.08;
function wheelZoomFactor(e: WheelEvent): number {
  if (e.deltaY === 0) return 1;
  if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(e.deltaY) >= 50) return e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
  return Math.exp(-e.deltaY * 0.01);
}

// Connectors whose crossings are worked out (hops); more are drawn straight.
const MAX_HOPPING_CONNECTORS = 300;

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  n: "sticky",
  r: "rect",
  o: "ellipse",
  d: "diamond",
  t: "text",
  l: "line",
  c: "connector",
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const clampCoord = (n: number) => Math.min(MAX_COORD, Math.max(-MAX_COORD, Math.round(n)));
const clampSize = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));

// The board of a whiteboard page (lib/whiteboard.ts): sticky notes, shapes,
// text, lines and connectors on a canvas that pans (drag with the right or middle
// button, or the background with the hand tool or Space held; scroll) and
// zooms (Ctrl/⌘ + scroll, pinch, the buttons). A drag that ends with Alt
// held leaves copies there and the originals where they were. Rectangles and
// ellipses are drawn by dragging (Shift: a square or a circle); a click makes
// one of the usual size; lines too (Shift: at 45° steps). Connectors run
// straight or turn at right angles. A box under the pointer shows dots on its sides to
// draw a connector from, and a selected connector's ends can be dragged to
// other boxes. Edits go straight into the Yjs document, so with a
// collaboration connection everyone sees them as they happen; undo only
// takes back this person's own edits. `awareness` shows the others'
// pointers. Read-only: the board can only be looked around.
//
// Dragged and resized boxes snap to the edges and centers of the others
// (guides show where; Ctrl/⌘ held: no snapping), or to the board's dots when
// that's switched on. Several selected boxes can be lined up or spread out
// evenly. Images (the image button, pasted or dropped) are attachments of the
// page (`pageId`). A box can link to a page (opened with the viewer's own
// access). The templates put in ready-made boards.
export function WhiteboardCanvas({
  doc,
  readOnly,
  awareness,
  dataUi = "Whiteboard",
  pageId,
  embedded = false,
}: {
  doc: Y.Doc;
  readOnly: boolean;
  awareness?: Awareness | null;
  dataUi?: string;
  // The page the board is on: where images are uploaded to (none: no images
  // can be put in).
  pageId?: string;
  // Shown in a document (the whiteboard block): a lower board in its frame.
  embedded?: boolean;
}) {
  const t = useTranslations("whiteboard");
  const tRoot = useTranslations();
  const router = useRouter();
  const markerId = useId().replace(/:/g, "");
  const viewportRef = useRef<HTMLDivElement>(null);
  const map = useMemo(() => whiteboardMap(doc), [doc]);
  // This screen's own edits, the only ones undo takes back.
  const origin = useMemo(() => ({ whiteboard: true }), []);
  // Made in an effect (not a memo), so a remount in development (Strict
  // Mode) doesn't leave a destroyed one behind. Only used by event handlers.
  const undo = useRef<Y.UndoManager | null>(null);
  useEffect(() => {
    const manager = new Y.UndoManager(map, { trackedOrigins: new Set([origin]) });
    undo.current = manager;
    return () => {
      manager.destroy();
      if (undo.current === manager) undo.current = null;
    };
  }, [map, origin]);

  const [items, setItems] = useState<WhiteboardItem[]>(() => readItems(doc));
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  // The board over the whole window (the sidebar out of the way); this
  // screen's own, not kept.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    // The page behind stays put, and keys go to the board.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    viewportRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Where a dragged or resized box lines up with others.
  const [guides, setGuides] = useState<Guide[]>([]);
  // (The board is only drawn in the browser: loaded without server rendering.)
  const [gridSnap, setGridSnap] = useState(readGridSnap);
  const toggleGridSnap = () => {
    setGridSnap(!gridSnap);
    try {
      if (gridSnap) window.localStorage.removeItem(GRID_KEY);
      else window.localStorage.setItem(GRID_KEY, "true");
    } catch {
      // Not kept (storage blocked).
    }
  };
  // The box whose link is being chosen (the page picker is open).
  const [linking, setLinking] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesRef = useRef<HTMLDivElement>(null);
  // The item whose text is being edited, and which text (a connector has three).
  const [editingText, setEditingText] = useState<{ id: string; field: TextField } | null>(null);
  const editing = editingText?.id ?? null;
  const setEditing = (id: string | null, field: TextField = "text") => setEditingText(id ? { id, field } : null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: Point } | null>(null);
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // The box whose connection dots are shown (under or near the pointer).
  const [hovered, setHovered] = useState<string | null>(null);
  // The connector whose end is being dragged (drawn as a draft meanwhile).
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  // While a connector's end is dragged: the box it would go to, and the side
  // (null: its middle, routed by itself).
  const [dropTarget, setDropTarget] = useState<{ id: string; side: Side | null } | null>(null);
  // While items are dragged: dashed outlines where they started (unless
  // they're copies, whose originals stay there anyway), and whether Alt is
  // held — letting go then leaves copies, marked with a "+".
  const [drag, setDrag] = useState<{ ghosts: Rect[]; moving: Set<string>; alt: boolean } | null>(null);

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());

  useEffect(() => {
    const update = () => setItems(readItems(doc));
    update();
    map.observeDeep(update);
    return () => map.unobserveDeep(update);
  }, [doc, map]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const boxes = useMemo(() => items.filter(isBox), [items]);
  const plainLines = useMemo(() => items.filter((i): i is LineItem => i.type === "line"), [items]);
  // The connectors' lines, back to front. Where one crosses a line below it
  // (earlier in the stacking order), it hops over that line (hopCrossings:
  // connectors between the same two boxes count as one line).
  const connectorPaths = useMemo(() => {
    const lines: {
      id: string;
      arrows: ArrowEnds;
      route: Route;
      stroke: Stroke;
      fromSide: Side | null;
      toSide: Side | null;
      from: string;
      to: string;
      pair: string;
      points: Point[];
    }[] = [];
    for (const item of items) {
      if (item.type !== "connector") continue;
      const points = connectorPoints(byId.get(item.from) as BoxItem, byId.get(item.to) as BoxItem, item.route, {
        from: item.fromSide,
        to: item.toSide,
      });
      const pair = [item.from, item.to].sort().join(" ");
      lines.push({ id: item.id, arrows: item.arrows, route: item.route, stroke: item.stroke, fromSide: item.fromSide, toSide: item.toSide, from: item.from, to: item.to, pair, points });
    }
    // Ends meeting a box at the same point, spread apart (unless the box
    // keeps them together).
    const spread = spreadEnds(lines, (id) => {
      const box = byId.get(id);
      return isBox(box) ? box : undefined;
    });
    // Every pair is checked: beyond this many, lines are drawn without hops.
    const crossings = spread.length <= MAX_HOPPING_CONNECTORS ? hopCrossings(spread) : spread.map(() => []);
    return spread.map((line, i) => ({ ...line, d: routePath(line.points, crossings[i]) }));
  }, [items, byId]);
  const connectorPoints_ = useMemo(() => new Map(connectorPaths.map((c) => [c.id, c.points])), [connectorPaths]);
  // Gone items (deleted by someone else) drop out of the selection.
  const selection = useMemo(() => new Set([...selected].filter((id) => byId.has(id))), [selected, byId]);

  // Shows the whole board when it opens.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setCamera(fitCamera(boundsOf(itemRects(readItems(doc))), el.clientWidth, el.clientHeight));
  }, [doc]);

  // Scroll pans; Ctrl/⌘ + scroll (and a trackpad pinch, which browsers send
  // as that) zooms at the pointer. Not passive, to keep the page from scrolling.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setCamera((c) => zoomAt(c, anchor, c.zoom * wheelZoomFactor(e)));
      } else {
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The others' pointers. The collab server puts each person's name and
  // color into `user`; only the position is ours to send.
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalState({ user: {}, whiteboard: null });
    const update = () => {
      const next: RemoteCursor[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const pos = (state as { whiteboard?: unknown }).whiteboard as Point | null | undefined;
        const user = (state as { user?: { name?: unknown; color?: unknown } }).user;
        if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") continue;
        next.push({
          clientId,
          name: typeof user?.name === "string" ? user.name : "",
          color: typeof user?.color === "string" ? user.color : "#888888",
          x: pos.x,
          y: pos.y,
        });
      }
      setCursors(next);
    };
    update();
    awareness.on("change", update);
    return () => {
      awareness.off("change", update);
      awareness.setLocalStateField("whiteboard", null);
    };
  }, [awareness]);

  // Pointer positions go out at most once per frame.
  const pendingPointer = useRef<Point | null | undefined>(undefined);
  const sendPointer = (p: Point | null) => {
    if (!awareness) return;
    const first = pendingPointer.current === undefined;
    pendingPointer.current = p;
    if (!first) return;
    requestAnimationFrame(() => {
      awareness.setLocalStateField("whiteboard", pendingPointer.current ?? null);
      pendingPointer.current = undefined;
    });
  };

  const change = (fn: () => void) => doc.transact(fn, origin);
  const setField = (id: string, fields: Record<string, unknown>) => {
    const item = map.get(id);
    if (!(item instanceof Y.Map)) return;
    for (const [key, value] of Object.entries(fields)) if (item.get(key) !== value) item.set(key, value);
  };
  const topZ = () => items.reduce((z, i) => Math.max(z, i.z), 0);

  const canvasPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const addItem = (fields: Record<string, unknown>): string | null => {
    if (map.size >= MAX_ITEMS) {
      showNotice(t("tooManyItems", { max: MAX_ITEMS }));
      return null;
    }
    const id = newId();
    change(() => {
      const item = new Y.Map<unknown>();
      for (const [key, value] of Object.entries({ ...fields, z: topZ() + 1 })) item.set(key, value);
      map.set(id, item);
    });
    return id;
  };

  const addBox = (type: BoxItem["type"], at: Point) => {
    const { w, h } = DEFAULT_SIZE[type];
    const id = addItem({
      type,
      x: clampCoord(at.x - w / 2),
      y: clampCoord(at.y - h / 2),
      w,
      h,
      text: "",
      color: DEFAULT_COLOR[type],
    });
    if (!id) return;
    setSelected(new Set([id]));
    setEditing(id);
  };

  // A new box of the same kind, size and color as `fromId` (empty, but for an
  // image's picture), centered at `at` and connected from it; then selected,
  // its text being edited.
  const connectToCopy = (fromId: string, fromSide: Side | null, at: Point) => {
    const from = readItems(doc).find((i) => i.id === fromId);
    if (!isBox(from)) return;
    if (map.size + 2 > MAX_ITEMS) {
      showNotice(t("tooManyItems", { max: MAX_ITEMS }));
      return;
    }
    const box = { ...from, x: clampCoord(at.x - from.w / 2), y: clampCoord(at.y - from.h / 2) };
    const id = newId();
    let z = topZ();
    undo.current?.stopCapturing();
    change(() => {
      const put = (key: string, fields: Record<string, unknown>) => {
        const item = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(fields)) item.set(k, v);
        map.set(key, item);
      };
      put(id, { type: from.type, x: box.x, y: box.y, w: from.w, h: from.h, text: "", ...(from.src ? { src: from.src } : {}), color: from.color, z: ++z });
      const toSide = sideToward(box, { x: from.x + from.w / 2, y: from.y + from.h / 2 });
      put(newId(), { type: "connector", from: fromId, to: id, arrows: "end", route: "straight", ...sideFields(fromSide, toSide), text: "", color: DEFAULT_COLOR.connector, z: ++z });
    });
    setSelected(new Set([id]));
    if (from.type !== "image") setEditing(id);
  };

  // The middle of what's on screen, on the board.
  const viewCenter = (): Point => {
    const el = viewportRef.current;
    return toWorld(camera, { x: (el?.clientWidth ?? 0) / 2, y: (el?.clientHeight ?? 0) / 2 });
  };

  // Images uploaded as attachments of the page and put on the board around
  // `at` (each a little further down and right), selected. Other files are
  // refused, as are types the administrators don't allow.
  const addImages = async (files: File[], at: Point) => {
    if (readOnly || !pageId) return;
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (images.length === 0) {
      if (files.length > 0) showNotice(t("imagesOnly"));
      return;
    }
    const policy = await getUploadPolicy().catch(() => ({ enabled: true, extensions: [] as string[] }));
    if (!policy.enabled) {
      await showAlert(tRoot("files.errors.disabled"), { title: t("imageRefused") });
      return;
    }
    const allowed = policy.extensions;
    const done = beginSaving();
    const added: string[] = [];
    try {
      for (const file of images) {
        if (!isUploadAllowed(file.name, allowed)) {
          await showAlert(uploadRefusedMessage(file.name, (key, values) => tRoot(`files.errors.${key}`, values)), { title: t("imageRefused") });
          continue;
        }
        let src: string;
        try {
          src = await postFile(pageId, file, t("uploadFailed"));
        } catch (error) {
          await showAlert(error instanceof UploadError ? error.message : t("uploadFailed"), { title: t("imageRefused") });
          continue;
        }
        const size = await naturalSize(file);
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(size.w, size.h));
        const w = clampSize(size.w * scale);
        const h = clampSize(size.h * scale);
        const offset = added.length * 24;
        const id = addItem({ type: "image", x: clampCoord(at.x - w / 2 + offset), y: clampCoord(at.y - h / 2 + offset), w, h, text: "", color: "white", src });
        if (id) added.push(id);
      }
    } finally {
      done();
    }
    if (added.length > 0) {
      setSelected(new Set(added));
      setTool("select");
    }
  };

  // A template put in the middle of the screen, as one step to undo; its
  // items become the selection.
  const insertTemplate = (name: TemplateName) => {
    setTemplatesOpen(false);
    const template = buildTemplate(name, // The keys come from templates.ts (whiteboard.templates.<name>.<key>).
      (key) => t(`templates.${key}` as "templates.kpt.title"),);
    if (map.size + template.boxes.length + template.connectors.length > MAX_ITEMS) {
      showNotice(t("tooManyItems", { max: MAX_ITEMS }));
      return;
    }
    const bounds = templateBounds(template);
    const center = viewCenter();
    const dx = Math.round(center.x - bounds.x - bounds.w / 2);
    const dy = Math.round(center.y - bounds.y - bounds.h / 2);
    const ids = new Map(template.boxes.map((b) => [b.key, newId()]));
    let z = topZ();
    undo.current?.stopCapturing();
    change(() => {
      const put = (id: string, fields: Record<string, unknown>) => {
        const item = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(fields)) item.set(key, value);
        map.set(id, item);
      };
      for (const b of template.boxes) {
        put(ids.get(b.key)!, {
          type: b.type,
          x: clampCoord(b.x + dx),
          y: clampCoord(b.y + dy),
          w: b.w,
          h: b.h,
          text: b.text,
          color: b.color,
          z: ++z,
          ...(b.connectorEnds ? { connectorEnds: b.connectorEnds } : {}),
        });
      }
      for (const c of template.connectors) {
        put(newId(), {
          type: "connector",
          from: ids.get(c.from)!,
          to: ids.get(c.to)!,
          arrows: c.arrows,
          route: c.route,
          text: "",
          color: DEFAULT_COLOR.connector,
          z: ++z,
          ...(c.fromSide ? { fromSide: c.fromSide } : {}),
          ...(c.toSide ? { toSide: c.toSide } : {}),
        });
      }
    });
    undo.current?.stopCapturing();
    setSelected(new Set(ids.values()));
    setEditing(null);
    setTool("select");
    // Too big for the screen at this zoom: zoomed out to show it all.
    const el = viewportRef.current;
    if (el && (bounds.w * camera.zoom > el.clientWidth - 96 || bounds.h * camera.zoom > el.clientHeight - 96)) {
      setCamera(fitCamera({ x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h }, el.clientWidth, el.clientHeight));
    }
    focusBoard();
  };

  // The templates' menu closes on a click elsewhere or Esc.
  useEffect(() => {
    if (!templatesOpen) return;
    const close = (e: PointerEvent) => {
      if (!templatesRef.current?.contains(e.target as Node)) setTemplatesOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTemplatesOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [templatesOpen]);

  // Boxes moved to the given top lefts (lining up, spreading out).
  const placeBoxes = (at: Map<string, { x: number; y: number }>) =>
    change(() => at.forEach((p, id) => setField(id, { x: clampCoord(p.x), y: clampCoord(p.y) })));

  // Where boxes snap to: every box but the ones being moved.
  const snapTargets = (moving: Set<string>): Rect[] => boxes.filter((b) => !moving.has(b.id));

  // Removes the items and the connectors attached to them.
  const removeItems = (ids: Set<string>) => {
    if (ids.size === 0) return;
    change(() => {
      for (const item of items) {
        if (ids.has(item.id) || (item.type === "connector" && (ids.has(item.from) || ids.has(item.to)))) map.delete(item.id);
      }
    });
    setSelected(new Set());
    setEditing(null);
  };

  // Copies of the boxes and lines (and the connectors between the boxes),
  // `offset` down and to the right, in front of everything. Returns the
  // copies' ids by the originals', or null when there's nothing to copy (or
  // no room). Read from the document, not the last render: a drag may have
  // just moved them.
  const copyBoxes = (ids: Set<string>, offset: number): Map<string, string> | null => {
    const current = readItems(doc);
    const chosen = current.filter((b): b is BoxItem | LineItem => (isBox(b) || b.type === "line") && ids.has(b.id));
    if (chosen.length === 0) return null;
    if (map.size + chosen.length > MAX_ITEMS) {
      showNotice(t("tooManyItems", { max: MAX_ITEMS }));
      return null;
    }
    const copies = new Map(chosen.map((b) => [b.id, newId()]));
    let z = current.reduce((top, i) => Math.max(top, i.z), 0);
    change(() => {
      for (const b of chosen) {
        const item = new Y.Map<unknown>();
        const fields =
          b.type === "line"
            ? { ...movedLine(b, offset, offset), type: b.type, arrows: b.arrows, ...strokeField(b.stroke), text: "", color: b.color, z: ++z }
            : {
                type: b.type,
                x: clampCoord(b.x + offset),
                y: clampCoord(b.y + offset),
                w: b.w,
                h: b.h,
                text: b.text,
                ...(b.textX || b.textY ? { textX: b.textX, textY: b.textY } : {}),
                ...(b.src ? { src: b.src } : {}),
                ...(b.link ? { link: b.link } : {}),
                ...(b.connectorEnds === "merge" ? { connectorEnds: b.connectorEnds } : {}),
                color: b.color,
                z: ++z,
              };
        for (const [key, value] of Object.entries(fields)) item.set(key, value);
        map.set(copies.get(b.id)!, item);
      }
      for (const c of current) {
        if (c.type !== "connector" || !copies.has(c.from) || !copies.has(c.to)) continue;
        const item = new Y.Map<unknown>();
        const fields = { type: "connector", from: copies.get(c.from)!, to: copies.get(c.to)!, arrows: c.arrows, route: c.route, ...strokeField(c.stroke), ...sideFields(c.fromSide, c.toSide), text: c.text, color: c.color, z: ++z };
        for (const [key, value] of Object.entries(fields)) item.set(key, value);
        map.set(newId(), item);
      }
    });
    return copies;
  };

  // The items and the connectors attached to them, in the document as it is
  // now. Call inside a transaction.
  const deleteWithConnectors = (ids: Set<string>) => {
    const gone = [...map].filter(([id, value]) => {
      const from = value.get("from");
      const to = value.get("to");
      return ids.has(id) || (typeof from === "string" && ids.has(from)) || (typeof to === "string" && ids.has(to));
    });
    for (const [id] of gone) map.delete(id);
  };

  // A little down and to the right; the copies become the selection.
  const duplicate = () => {
    const copies = copyBoxes(selection, 24);
    if (copies) setSelected(new Set(copies.values()));
  };

  // Copy and paste (clipboard.ts). A paste goes under the pointer while it's
  // on the board, else to the middle of the screen; pasting the same again
  // there, each a little further down and to the right.
  const pointerWorld = useRef<Point | null>(null);
  const lastPaste = useRef<{ key: string; at: Point; count: number } | null>(null);

  const copySelection = (data: DataTransfer): boolean => {
    const chosen = clipItems(items, selection);
    if (chosen.length === 0) return false;
    data.setData("text/html", clipHtml(pageId ?? "", chosen));
    data.setData("text/plain", clipText(chosen));
    return true;
  };

  const pasteClip = async (clip: Clip, key: string) => {
    if (clip.skipped > 0) showNotice(t("pasteSkipped", { count: clip.skipped }));
    let pasted = clip.items;
    const bounds = clipBounds(pasted);
    if (!bounds) return;
    if (map.size + pasted.length > MAX_ITEMS) {
      showNotice(t("tooManyItems", { max: MAX_ITEMS }));
      return;
    }
    // Images of another page: made this page's own first, as in documents
    // (lib/file-copy.ts), so everyone who can open this page sees them.
    const fileIds = [...new Set(pasted.flatMap((i) => (isBox(i) && i.src ? [i.src.slice("/api/files/".length)] : [])))];
    if (pageId && clip.page !== pageId && fileIds.length > 0) {
      const done = beginSaving();
      // Pasted by this person: copied without asking.
      const adopted = await adoptPageFiles(pageId, fileIds, true)
        .then((r) => r.urls)
        .catch(() => ({}) as Record<string, string | null>);
      done();
      pasted = pasted.map((i) => (isBox(i) && i.src ? { ...i, src: adopted[i.src.slice("/api/files/".length)] ?? i.src } : i));
    }
    const at = pointerWorld.current ?? viewCenter();
    const last = lastPaste.current;
    const count = last && last.key === key && last.at.x === at.x && last.at.y === at.y ? last.count + 1 : 0;
    lastPaste.current = { key, at, count };
    const dx = Math.round(at.x - bounds.x - bounds.w / 2) + count * 24;
    const dy = Math.round(at.y - bounds.y - bounds.h / 2) + count * 24;
    const ids = new Map(pasted.map((i) => [i.id, newId()]));
    let z = topZ();
    undo.current?.stopCapturing();
    change(() => {
      for (const i of pasted) {
        const fields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(i)) if (k !== "id" && v !== null && v !== "") fields[k] = v;
        if (i.type === "connector") Object.assign(fields, { from: ids.get(i.from), to: ids.get(i.to), text: i.text });
        else if (i.type === "line") Object.assign(fields, movedLine(i, dx, dy));
        else Object.assign(fields, { x: clampCoord(i.x + dx), y: clampCoord(i.y + dy), text: i.text });
        fields.z = ++z;
        const item = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(fields)) item.set(k, v);
        map.set(ids.get(i.id)!, item);
      }
    });
    undo.current?.stopCapturing();
    setSelected(new Set(pasted.filter((i) => i.type !== "connector").map((i) => ids.get(i.id)!)));
    setEditing(null);
    setTool("select");
  };

  // Text from elsewhere: a text box with it.
  const pasteText = (text: string) => {
    const lines = text.replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT_LENGTH).split("\n");
    if (lines.join("").trim() === "") return;
    // About as wide as the longest line (wide characters twice), within reason.
    const width = (line: string) => [...line].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e7f ? 16 : 8), 0);
    const w = Math.min(480, Math.max(DEFAULT_SIZE.text.w, Math.max(...lines.map(width)) + 16));
    const rows = lines.reduce((n, line) => n + Math.max(1, Math.ceil((width(line) + 16) / w)), 0);
    const h = Math.min(MAX_SIZE, DEFAULT_SIZE.text.h * rows);
    const at = pointerWorld.current ?? viewCenter();
    const id = addItem({ type: "text", x: clampCoord(at.x - w / 2), y: clampCoord(at.y - h / 2), w, h, text: lines.join("\n"), color: DEFAULT_COLOR.text });
    if (id) {
      setSelected(new Set([id]));
      setTool("select");
    }
  };

  const moveSelection = (dx: number, dy: number) => {
    change(() => {
      for (const b of boxes) if (selection.has(b.id)) setField(b.id, { x: clampCoord(b.x + dx), y: clampCoord(b.y + dy) });
      for (const l of plainLines) if (selection.has(l.id)) setField(l.id, movedLine(l, dx, dy));
    });
  };

  const restack = (front: boolean) => {
    const chosen = items.filter((i) => selection.has(i.id));
    if (chosen.length === 0) return;
    const others = items.filter((i) => !selection.has(i.id));
    const order = front ? [...others, ...chosen] : [...chosen, ...others];
    change(() => order.forEach((item, index) => setField(item.id, { z: index + 1 })));
  };

  const setColor = (color: ItemColor) => change(() => selection.forEach((id) => setField(id, { color })));
  // The selected boxes become another kind (their place, size, text and
  // connectors stay). Not images.
  const setShape = (type: (typeof SHAPE_TYPES)[number]) =>
    change(() =>
      selection.forEach((id) => {
        const box = byId.get(id);
        if (isBox(box) && isShapeType(box.type)) setField(id, { type });
      }),
    );
  // The selected boxes' text back where it would be.
  const resetTextPlace = () => change(() => selection.forEach((id) => isBox(byId.get(id)) && setField(id, { textX: 0, textY: 0 })));
  // The selected boxes' text made a list, or plain again.
  const setList = (kind: "bullet" | "number") =>
    change(() =>
      selection.forEach((id) => {
        const box = byId.get(id);
        if (isBox(box) && box.text.trim()) setField(id, { text: toggleList(box.text, kind) });
      }),
    );
  const setArrows = (arrows: ArrowEnds) =>
    change(() => selection.forEach((id) => hasArrows(byId.get(id)) && setField(id, { arrows })));
  const setRoute = (route: Route) =>
    change(() => selection.forEach((id) => byId.get(id)?.type === "connector" && setField(id, { route })));
  const setConnectorEnds = (connectorEnds: ConnectorEnds) =>
    change(() => selection.forEach((id) => isBox(byId.get(id)) && setField(id, { connectorEnds })));
  const setStroke = (stroke: Stroke) =>
    change(() => selection.forEach((id) => hasArrows(byId.get(id)) && setField(id, { stroke })));


  // After a button: the board's keys (Esc, Delete, the tools) work again.
  const focusBoard = () => viewportRef.current?.focus({ preventScroll: true });

  const fit = () => {
    const el = viewportRef.current;
    if (el) setCamera(fitCamera(boundsOf(itemRects(items)), el.clientWidth, el.clientHeight));
  };
  // Zooms at the middle of the board: to the next step (ZOOM_STEPS) up or
  // down, or to a given zoom.
  const zoomTo = (zoom: (current: number) => number) => {
    const el = viewportRef.current;
    if (!el) return;
    setCamera((c) => zoomAt(c, { x: el.clientWidth / 2, y: el.clientHeight / 2 }, zoom(c.zoom)));
  };
  const zoomBy = (dir: 1 | -1) => zoomTo((z) => stepZoom(z, dir));

  // Moves of the selection are written at most once per frame.
  const frame = useRef<number | null>(null);
  const pendingWrite = useRef<(() => void) | null>(null);
  const writeSoon = (fn: () => void) => {
    pendingWrite.current = fn;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      const write = pendingWrite.current;
      pendingWrite.current = null;
      write?.();
    });
  };
  const flushWrite = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const write = pendingWrite.current;
    pendingWrite.current = null;
    write?.();
  };

  // The item an element belongs to (a box's connection dots, its box).
  const itemAt = (target: EventTarget | null): string | null => {
    const el = (target as Element | null)?.closest?.("[data-wb-id], [data-wb-connect]");
    return el?.getAttribute("data-wb-id") ?? el?.getAttribute("data-wb-connect") ?? null;
  };
  // The box a connector's end would go to at this point of the screen, and the
  // side (toward which the point lies).
  const dropAt = (clientX: number, clientY: number, world: Point) => {
    const box = byId.get(itemAt(document.elementFromPoint(clientX, clientY)) ?? "");
    return isBox(box) ? { box, side: sideToward(box, world) } : null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    // Typing into an item, or using the controls: not a drag on the board;
    // nor a box's link (followed on its click).
    if (target.closest("textarea, button, [data-wb-controls], [data-wb-link]")) return;
    viewportRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = canvasPoint(e);
    pointers.current.set(e.pointerId, point);
    const world = toWorld(camera, point);

    // A second finger: pinch to zoom (whatever the first one was doing).
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", distance: Math.hypot(p1.x - p2.x, p1.y - p2.y), mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, camera };
      setMarquee(null);
      setDraft(null);
      return;
    }
    if (pointers.current.size > 2) return;

    if (e.button === 1 || e.button === 2 || tool === "hand" || spaceHeld || readOnly) {
      gesture.current = { kind: "pan", start: point, camera };
      return;
    }
    if (e.button !== 0) return;
    const hit = itemAt(target);

    // A box's connection dot: a connector drawn from that box.
    const dotEl = tool === "select" ? target.closest("[data-wb-connect]") : null;
    const dot = dotEl?.getAttribute("data-wb-connect");
    if (dot && isBox(byId.get(dot))) {
      const side = dotEl!.getAttribute("data-id");
      gesture.current = { kind: "connect", from: dot, fromSide: (SIDES as readonly (string | null)[]).includes(side) ? (side as Side) : null };
      setDraft({ from: dot, to: world });
      setHovered(null);
      return;
    }
    // A selected line's end: moved.
    const lineEnd = target.closest("[data-wb-lineend]")?.getAttribute("data-wb-lineend");
    if (tool === "select" && (lineEnd === "1" || lineEnd === "2") && single?.type === "line") {
      undo.current?.stopCapturing();
      const [p1, p2] = lineEnds(single);
      gesture.current = { kind: "lineEnd", id: single.id, end: lineEnd, fixed: lineEnd === "1" ? p2 : p1 };
      return;
    }
    // A selected connector's end: attached to another box where it's dropped.
    const end = target.closest("[data-wb-end]")?.getAttribute("data-wb-end");
    if (tool === "select" && (end === "from" || end === "to") && single?.type === "connector") {
      const fixed = end === "from" ? single.to : single.from;
      gesture.current = { kind: "reconnect", id: single.id, end, fixed };
      setReconnecting(single.id);
      setDraft({ from: fixed, to: world });
      return;
    }

    if (tool === "connector") {
      const box = hit ? byId.get(hit) : undefined;
      if (isBox(box)) {
        gesture.current = { kind: "connect", from: box.id, fromSide: null };
        setDraft({ from: box.id, to: world });
      }
      return;
    }
    if (tool === "rect" || tool === "ellipse" || tool === "diamond") {
      undo.current?.stopCapturing();
      gesture.current = { kind: "draw", type: tool, start: world, id: null };
      return;
    }
    if (tool === "line") {
      undo.current?.stopCapturing();
      gesture.current = { kind: "drawLine", start: world, id: null };
      return;
    }
    if (tool !== "select") {
      addBox(tool, world);
      setTool("select");
      return;
    }
    if (target.closest("[data-wb-textmove]") && hit) {
      const box = byId.get(hit);
      if (isBox(box)) {
        undo.current?.stopCapturing();
        gesture.current = { kind: "moveText", id: hit, start: world, origin: { x: box.textX, y: box.textY } };
      }
      return;
    }
    if (target.closest("[data-wb-handle]") && hit) {
      const box = byId.get(hit);
      if (isBox(box)) {
        undo.current?.stopCapturing();
        gesture.current = { kind: "resize", id: hit, start: world, origin: { w: box.w, h: box.h } };
      }
      return;
    }
    if (hit) {
      const wasSelected = selection.has(hit);
      let next = selection;
      if (e.shiftKey) {
        next = new Set(selection);
        if (wasSelected) next.delete(hit);
        else next.add(hit);
      } else if (!wasSelected) {
        next = new Set([hit]);
      }
      if (editing !== hit) setEditing(null);
      undo.current?.stopCapturing();
      // Alt + drag: copies of the selection (with the box under the pointer),
      // made where they are, are what moves; the originals stay.
      const copies = e.altKey && !e.shiftKey ? copyBoxes(next, 0) : null;
      const origins = new Map<string, Point>();
      for (const b of boxes) if (next.has(b.id)) origins.set(copies?.get(b.id) ?? b.id, { x: b.x, y: b.y });
      const lineOrigins = new Map<string, LineEnds>();
      for (const l of plainLines) if (next.has(l.id)) lineOrigins.set(copies?.get(l.id) ?? l.id, movedLine(l, 0, 0));
      setSelected(copies ? new Set(copies.values()) : next);
      gesture.current = {
        kind: "move",
        start: world,
        origins,
        lineOrigins,
        moved: false,
        clicked: copies?.get(hit) ?? hit,
        wasSelected: wasSelected && !e.shiftKey && !copies,
        copiedFrom: copies ? new Map([...copies].map(([original, copy]) => [copy, original])) : undefined,
      };
      return;
    }
    setEditing(null);
    const base = e.shiftKey ? new Set(selection) : new Set<string>();
    setSelected(base);
    gesture.current = { kind: "marquee", start: world, base };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const point = canvasPoint(e);
    const world = toWorld(camera, point);
    sendPointer(world);
    pointerWorld.current = world;
    if (!gesture.current && tool === "select" && !readOnly) {
      // The front box at or near the pointer (near: its dots lie just outside).
      const pad = 24 / camera.zoom;
      const near = [...boxes].reverse().find((b) => world.x >= b.x - pad && world.x <= b.x + b.w + pad && world.y >= b.y - pad && world.y <= b.y + b.h + pad);
      setHovered(near?.id ?? null);
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, point);
    const g = gesture.current;
    if (!g) return;
    switch (g.kind) {
      case "pinch": {
        const [p1, p2] = [...pointers.current.values()];
        if (!p1 || !p2) return;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const zoomed = zoomAt(g.camera, g.mid, (g.camera.zoom * Math.hypot(p1.x - p2.x, p1.y - p2.y)) / Math.max(g.distance, 1));
        setCamera({ ...zoomed, x: zoomed.x + mid.x - g.mid.x, y: zoomed.y + mid.y - g.mid.y });
        return;
      }
      case "pan":
        setCamera({ ...g.camera, x: g.camera.x + point.x - g.start.x, y: g.camera.y + point.y - g.start.y });
        return;
      case "move": {
        const dx = world.x - g.start.x;
        const dy = world.y - g.start.y;
        if (!g.moved && Math.hypot(dx * camera.zoom, dy * camera.zoom) < 3) return;
        if (!g.moved) {
          const ghosts: Rect[] = [];
          if (!g.copiedFrom) {
            for (const [id, o] of g.origins) {
              const box = byId.get(id);
              if (isBox(box)) ghosts.push({ x: o.x, y: o.y, w: box.w, h: box.h });
            }
          }
          setDrag({ ghosts, moving: new Set([...g.origins.keys(), ...g.lineOrigins.keys()]), alt: e.altKey });
        } else {
          setDrag((d) => (d && d.alt !== e.altKey ? { ...d, alt: e.altKey } : d));
        }
        g.moved = true;
        // Snapped: the rectangle around what moves, lined up with the others
        // (or on the dots). Ctrl/⌘ held: just where the pointer is.
        let sx = dx;
        let sy = dy;
        const rects: Rect[] = [];
        for (const [id, o] of g.origins) {
          const box = byId.get(id);
          if (isBox(box)) rects.push({ x: o.x + dx, y: o.y + dy, w: box.w, h: box.h });
        }
        for (const o of g.lineOrigins.values()) rects.push(lineRect({ ...o, ...movedLine(o, dx, dy) } as LineItem));
        const around = boundsOf(rects);
        if (around && !(e.ctrlKey || e.metaKey)) {
          const snap = snapMove(around, snapTargets(new Set(g.origins.keys())), SNAP_PX / camera.zoom, gridSnap);
          sx += snap.dx;
          sy += snap.dy;
          setGuides(snap.guides);
        } else setGuides([]);
        writeSoon(() =>
          change(() => {
            for (const [id, o] of g.origins) setField(id, { x: clampCoord(o.x + sx), y: clampCoord(o.y + sy) });
            for (const [id, o] of g.lineOrigins) setField(id, movedLine(o, sx, sy));
          }),
        );
        return;
      }
      case "moveText": {
        const textX = Math.round(g.origin.x + world.x - g.start.x);
        const textY = Math.round(g.origin.y + world.y - g.start.y);
        writeSoon(() => change(() => setField(g.id, { textX, textY })));
        return;
      }
      case "resize": {
        let w = clampSize(g.origin.w + world.x - g.start.x);
        let h = clampSize(g.origin.h + world.y - g.start.y);
        const box = byId.get(g.id);
        if (box?.type === "image" && !e.shiftKey) {
          // An image keeps its shape (Shift: stretched freely).
          h = clampSize((w * g.origin.h) / g.origin.w);
          setGuides([]);
        } else if (isBox(box) && !(e.ctrlKey || e.metaKey)) {
          const snap = snapResize({ x: box.x, y: box.y, w, h }, snapTargets(new Set([g.id])), SNAP_PX / camera.zoom, gridSnap);
          w = clampSize(snap.w);
          h = clampSize(snap.h);
          setGuides(snap.guides);
        } else setGuides([]);
        writeSoon(() => change(() => setField(g.id, { w, h })));
        return;
      }
      case "marquee": {
        setMarquee({ a: g.start, b: world });
        const area = rectFrom(g.start, world);
        const next = new Set(g.base);
        for (const b of boxes) if (intersects(area, b)) next.add(b.id);
        for (const l of plainLines) if (intersects(area, lineRect(l))) next.add(l.id);
        setSelected(next);
        return;
      }
      case "connect":
      case "reconnect": {
        const from = g.kind === "connect" ? g.from : g.fixed;
        setDraft({ from, to: world });
        const drop = dropAt(e.clientX, e.clientY, world);
        const next = drop && drop.box.id !== from ? { id: drop.box.id, side: drop.side } : null;
        setDropTarget((d) => (d?.id === next?.id && d?.side === next?.side ? d : next));
        return;
      }
      case "draw": {
        let dx = world.x - g.start.x;
        let dy = world.y - g.start.y;
        if (!g.id && Math.hypot(dx * camera.zoom, dy * camera.zoom) < 4) return;
        // Shift: a square or a circle, as big as the larger side.
        if (e.shiftKey) {
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * side;
          dy = Math.sign(dy || 1) * side;
        }
        const fields = {
          x: clampCoord(Math.min(g.start.x, g.start.x + dx)),
          y: clampCoord(Math.min(g.start.y, g.start.y + dy)),
          w: clampSize(Math.abs(dx)),
          h: clampSize(Math.abs(dy)),
        };
        if (!g.id) {
          g.id = addItem({ type: g.type, ...fields, text: "", color: DEFAULT_COLOR[g.type] });
          if (!g.id) gesture.current = null;
          return;
        }
        const id = g.id;
        writeSoon(() => change(() => setField(id, fields)));
        return;
      }
      case "drawLine": {
        if (!g.id && Math.hypot((world.x - g.start.x) * camera.zoom, (world.y - g.start.y) * camera.zoom) < 4) return;
        const to = e.shiftKey ? snapAngle(g.start, world) : world;
        const fields = { x2: clampCoord(to.x), y2: clampCoord(to.y) };
        if (!g.id) {
          g.id = addItem({ type: "line", x1: clampCoord(g.start.x), y1: clampCoord(g.start.y), ...fields, arrows: "none", text: "", color: DEFAULT_COLOR.line });
          if (!g.id) gesture.current = null;
          return;
        }
        const id = g.id;
        writeSoon(() => change(() => setField(id, fields)));
        return;
      }
      case "lineEnd": {
        const to = e.shiftKey ? snapAngle(g.fixed, world) : world;
        writeSoon(() => change(() => setField(g.id, { [`x${g.end}`]: clampCoord(to.x), [`y${g.end}`]: clampCoord(to.y) })));
        return;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "pinch") {
      // Back to one finger: it pans from here.
      const rest = [...pointers.current.values()][0];
      gesture.current = rest ? { kind: "pan", start: rest, camera } : null;
      return;
    }
    gesture.current = null;
    flushWrite();
    setDrag(null);
    setDropTarget(null);
    setGuides([]);
    if (!g) return;
    if (g.kind === "marquee") setMarquee(null);
    if (g.kind === "draw") {
      // A click without a drag: the usual size, centered there.
      if (g.id) {
        setSelected(new Set([g.id]));
        setEditing(g.id);
      } else {
        addBox(g.type, g.start);
      }
      setTool("select");
    }
    if (g.kind === "drawLine") {
      // A click without a drag: a level line of the usual length, centered there.
      const id =
        g.id ??
        addItem({
          type: "line",
          x1: clampCoord(g.start.x - DEFAULT_LINE_LENGTH / 2),
          y1: clampCoord(g.start.y),
          x2: clampCoord(g.start.x + DEFAULT_LINE_LENGTH / 2),
          y2: clampCoord(g.start.y),
          arrows: "none",
          text: "",
          color: DEFAULT_COLOR.line,
        });
      if (id) setSelected(new Set([id]));
      setTool("select");
    }
    // A click on one of several selected: it becomes the key to line the
    // others up with (the first in the selection), the selection kept.
    if (g.kind === "move" && !g.moved && g.wasSelected) setSelected((s) => new Set([g.clicked, ...s]));
    // Alt + click without a drag: no copies left lying on the originals.
    if (g.kind === "move" && !g.moved && g.copiedFrom) {
      const copiedFrom = g.copiedFrom;
      change(() => deleteWithConnectors(new Set(copiedFrom.keys())));
      setSelected(new Set(copiedFrom.values()));
    }
    // Alt held when the drag ends decides, whenever it was pressed.
    if (g.kind === "move" && g.moved && e.altKey && !g.copiedFrom) {
      // Copies stay where the items were dropped; the items go back.
      const copies = copyBoxes(new Set([...g.origins.keys(), ...g.lineOrigins.keys()]), 0);
      if (copies) {
        change(() => {
          for (const [id, o] of g.origins) setField(id, { x: o.x, y: o.y });
          for (const [id, o] of g.lineOrigins) setField(id, o);
        });
        setSelected(new Set(copies.values()));
      }
    }
    if (g.kind === "move" && g.moved && !e.altKey && g.copiedFrom) {
      // Alt let go during the drag: no copies after all; the items go where
      // their copies were dropped.
      const copiedFrom = g.copiedFrom;
      const now = new Map(readItems(doc).map((i) => [i.id, i]));
      change(() => {
        for (const [copy, original] of copiedFrom) {
          const moved = now.get(copy);
          if (isBox(moved)) setField(original, { x: moved.x, y: moved.y });
          if (moved?.type === "line") setField(original, movedLine(moved, 0, 0));
        }
        deleteWithConnectors(new Set(copiedFrom.keys()));
      });
      setSelected(new Set(copiedFrom.values()));
    }
    if (g.kind === "reconnect") {
      setDraft(null);
      setReconnecting(null);
      const drop = dropAt(e.clientX, e.clientY, toWorld(camera, canvasPoint(e)));
      const box = drop?.box;
      // Not onto two boxes another connector already links through the same
      // sides (either way).
      const moving = byId.get(g.id);
      const fixedSide = moving?.type === "connector" ? (g.end === "from" ? moving.toSide : moving.fromSide) : null;
      const taken = box && items.some((i) => i.type === "connector" && i.id !== g.id && linksBoxes(i, box.id, drop.side, g.fixed, fixedSide));
      // The side it was dropped toward: an elbow runs into (or out of) that side.
      if (taken) showNotice(t("connectorExists"));
      else if (box && box.id !== g.fixed) change(() => setField(g.id, { [g.end]: box.id, [`${g.end}Side`]: drop.side }));
    }
    if (g.kind === "connect") {
      setDraft(null);
      const world = toWorld(camera, canvasPoint(e));
      const drop = dropAt(e.clientX, e.clientY, world);
      const box = drop?.box;
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (!box && under && viewportRef.current?.contains(under) && !itemAt(under)) {
        // Dropped on the empty board: a new box like the one it's drawn from,
        // there, connected to it (one step to undo).
        connectToCopy(g.from, g.fromSide, world);
      } else if (box && box.id !== g.from) {
        // Already connected through the same sides (either way): that
        // connector, not a second on top of it, selected and told. Its
        // arrowheads say which way it points.
        const existing = items.find((i) => i.type === "connector" && linksBoxes(i, g.from, g.fromSide, box.id, drop.side));
        if (existing) showNotice(t("connectorExists"));
        const id =
          existing?.id ??
          addItem({
            type: "connector",
            from: g.from,
            to: box.id,
            arrows: "end",
            route: "straight",
            ...sideFields(g.fromSide, drop.side),
            text: "",
            color: DEFAULT_COLOR.connector,
          });
        if (id) setSelected(new Set([id]));
      }
      setTool("select");
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // What's under the pointer: the board captures the pointer on each
    // press, so the event itself is the board's, not the item's.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (readOnly || tool !== "select" || !under || under.closest("textarea, button, [data-wb-controls]")) return;
    // An item's text is edited; the background does nothing.
    const hit = itemAt(under);
    if (!hit) return;
    setSelected(new Set([hit]));
    // A line has no text: it's made level or upright, whichever it's nearer.
    const item = byId.get(hit);
    if (item?.type === "image") return;
    if (item?.type === "line") change(() => setField(hit, movedLine(straightened(item), 0, 0)));
    else if (item?.type === "connector") {
      // A connector: the text by its start or end, if clicked in its first or
      // last quarter (a label there: that label), else the one halfway.
      const label = under.closest("[data-wb-field]")?.getAttribute("data-wb-field");
      const along = fractionAlong(connectorPoints_.get(hit) ?? [], toWorld(camera, canvasPoint(e)));
      const field = label === "startText" || label === "endText" || label === "text" ? label : along < 0.25 ? "startText" : along > 0.75 ? "endText" : "text";
      setEditing(hit, field);
    } else setEditing(hit);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("textarea")) return;
    // Alt pressed mid-drag, before the pointer moves again.
    if (e.key === "Alt") {
      setDrag((d) => (d && !d.alt ? { ...d, alt: true } : d));
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (key === " " && !e.repeat) {
      e.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (key === "+" || key === "=") return zoomBy(1);
    if (key === "-") return zoomBy(-1);
    if (key === "0" && mod) {
      e.preventDefault();
      return fit();
    }
    if (key === "escape") {
      // Nothing left to let go of: out of full screen.
      if (selection.size === 0 && tool === "select") setFullscreen(false);
      setSelected(new Set());
      setTool("select");
      return;
    }
    if (readOnly) return;
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) undo.current?.redo();
      else undo.current?.undo();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      undo.current?.redo();
      return;
    }
    if (mod && key === "a") {
      e.preventDefault();
      setSelected(new Set(items.map((i) => i.id)));
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      duplicate();
      return;
    }
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      removeItems(selection);
      return;
    }
    if (key === "enter" && selection.size === 1 && single?.type !== "line" && single?.type !== "image") {
      e.preventDefault();
      setEditing([...selection][0]);
      return;
    }
    const arrows: Record<string, Point> = { arrowleft: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 }, arrowup: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 } };
    if (arrows[key] && selection.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      moveSelection(arrows[key].x * step, arrows[key].y * step);
      return;
    }
    if (!mod && !e.altKey && TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
  };

  const editText = (id: string, field: TextField, text: string) => change(() => setField(id, { [field]: text.slice(0, MAX_TEXT_LENGTH) }));
  const finishEditing = (id: string) => {
    setEditingText((current) => (current?.id === id ? null : current));
    // An empty text item would be invisible.
    const item = byId.get(id);
    const text = map.get(id)?.get("text");
    if (item?.type === "text" && !text) removeItems(new Set([id]));
  };

  const tools: { tool: Tool; label: string; icon: IconName; dataUi: string }[] = [
    { tool: "select", label: t("tools.select"), icon: "select", dataUi: "selectToolButton" },
    { tool: "hand", label: t("tools.hand"), icon: "hand", dataUi: "handToolButton" },
    { tool: "sticky", label: t("tools.sticky"), icon: "sticky", dataUi: "stickyToolButton" },
    { tool: "rect", label: t("tools.rect"), icon: "rect", dataUi: "rectToolButton" },
    { tool: "ellipse", label: t("tools.ellipse"), icon: "ellipse", dataUi: "ellipseToolButton" },
    { tool: "diamond", label: t("tools.diamond"), icon: "diamond", dataUi: "diamondToolButton" },
    { tool: "text", label: t("tools.text"), icon: "text", dataUi: "textToolButton" },
    { tool: "line", label: t("tools.line"), icon: "line", dataUi: "lineToolButton" },
    { tool: "connector", label: t("tools.connector"), icon: "connector", dataUi: "connectorToolButton" },
  ];

  const panning = tool === "hand" || spaceHeld;
  const single = selection.size === 1 ? byId.get([...selection][0]) : undefined;
  const connectorSelected = [...selection].some((id) => byId.get(id)?.type === "connector");
  const arrowsSelected = [...selection].some((id) => hasArrows(byId.get(id)));
  const selectedBoxes = boxes.filter((b) => selection.has(b.id));
  // The box the others are lined up with: the first selected (the selection
  // keeps the order things were picked in), or the one clicked again.
  const alignKey = selectedBoxes.length >= 2 ? ([...selection].find((id) => isBox(byId.get(id))) ?? null) : null;
  const alignKeyBox = alignKey ? (byId.get(alignKey) as BoxItem) : null;
  const shapeSelected = selectedBoxes.some((b) => isShapeType(b.type));
  const colorable = [...selection].some((id) => byId.get(id)?.type !== "image");
  const singleBox = isBox(single) ? single : null;
  // Selected boxes connectors are attached to: their ends spread or merged.
  const connectedBoxes = selectedBoxes.filter((b) => items.some((i) => i.type === "connector" && (i.from === b.id || i.to === b.id)));
  const textMoved = [...selection].some((id) => {
    const box = byId.get(id);
    return isBox(box) && (box.textX !== 0 || box.textY !== 0);
  });

  // Connection dots: not while editing that box, nor on a read-only board.
  const hoveredItem = hovered && !readOnly && tool === "select" && editing !== hovered ? byId.get(hovered) : undefined;
  const hoveredBox = isBox(hoveredItem) ? hoveredItem : null;
  // A single selected connector's ends, to drag elsewhere.
  const endHandles = (() => {
    if (readOnly || single?.type !== "connector" || reconnecting) return null;
    const points = connectorPoints_.get(single.id);
    return points ? { from: points[0], to: points[points.length - 1] } : null;
  })();
  // A single selected line's ends.
  const lineHandles = !readOnly && single?.type === "line" ? lineEnds(single) : null;

  return (
    <div className={embedded ? `${styles.root} ${styles.embedded}` : styles.root} data-ui={dataUi} data-fullscreen={fullscreen || undefined}>
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-ui="Whiteboard.canvas"
        data-tool={tool}
        data-panning={panning ? "" : undefined}
        role="application"
        aria-label={t("canvasLabel")}
        aria-roledescription={t("roleDescription")}
        tabIndex={0}
        onPointerDown={onPointerDown}
        // The board takes focus itself (onPointerDown): the browser's own
        // focus change would come after a new item's text field got focus,
        // and close it again.
        onMouseDown={(e) => {
          if (!(e.target as Element).closest("textarea, button")) e.preventDefault();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          sendPointer(null);
          pointerWorld.current = null;
          setHovered(null);
        }}
        onDoubleClick={onDoubleClick}
        // The right button pans the board instead.
        onContextMenu={(e) => {
          if (!(e.target as Element).closest("textarea")) e.preventDefault();
        }}
        onKeyDown={onKeyDown}
        // The selection copied (also from a board one can only view), or cut.
        onCopy={(e) => {
          if ((e.target as Element).closest("textarea") || !copySelection(e.clipboardData)) return;
          e.preventDefault();
        }}
        onCut={(e) => {
          if (readOnly || (e.target as Element).closest("textarea") || !copySelection(e.clipboardData)) return;
          e.preventDefault();
          removeItems(selection);
        }}
        // Items copied on a board or in Miro, images, or text, pasted.
        onPaste={(e) => {
          if (readOnly || (e.target as Element).closest("textarea")) return;
          const html = e.clipboardData.getData("text/html");
          const clip = html ? readClip(html) : null;
          if (clip) {
            e.preventDefault();
            void pasteClip(clip, html);
            return;
          }
          const files = [...e.clipboardData.files];
          if (files.length > 0) {
            if (!pageId) return;
            e.preventDefault();
            void addImages(files, pointerWorld.current ?? viewCenter());
            return;
          }
          const text = e.clipboardData.getData("text/plain");
          if (text.trim()) {
            e.preventDefault();
            pasteText(text);
          }
        }}
        onDragOver={(e) => {
          if (readOnly || !pageId || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          if (readOnly || !pageId || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          void addImages([...e.dataTransfer.files], toWorld(camera, canvasPoint(e)));
        }}
        onKeyUp={(e) => {
          if (e.key === " ") setSpaceHeld(false);
          if (e.key === "Alt") setDrag((d) => (d?.alt ? { ...d, alt: false } : d));
        }}
        onBlur={() => setSpaceHeld(false)}
      >
        <div
          className={styles.layer}
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            ["--zoom" as string]: camera.zoom,
          }}
        >
          <svg className={styles.lines} aria-hidden>
            <defs>
              {(["normal", "large"] as const).flatMap((size) =>
                [false, true].map((sel) => (
                  <marker
                    key={`${size}${sel}`}
                    id={markerRef(markerId, size === "large", sel)}
                    viewBox="0 0 10 10"
                    refX={ARROW_HEADS[size].refX}
                    refY="5"
                    markerWidth={ARROW_HEADS[size].size}
                    markerHeight={ARROW_HEADS[size].size}
                    markerUnits="userSpaceOnUse"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" className={sel ? styles.arrowSelected : styles.arrow} />
                  </marker>
                )),
              )}
            </defs>
            {connectorPaths.map(({ id, arrows, route, stroke, d, from, to, fromSide, toSide }) => {
              if (id === reconnecting) return null;
              const isSelected = selection.has(id);
              return (
                <g
                  key={id}
                  data-wb-id={id}
                  data-ui="Whiteboard.connector"
                  data-id={id}
                  data-arrows={arrows}
                  data-route={route}
                  data-stroke={stroke}
                  data-from-side={fromSide ?? undefined}
                  data-to-side={toSide ?? undefined}
                  data-from={from}
                  data-to={to}
                >
                  <path d={d} className={styles.lineHit} />
                  <StrokePaths d={d} stroke={stroke} arrows={arrows} selected={isSelected} markerId={markerId} />
                </g>
              );
            })}
            {draft && byId.get(draft.from)?.type !== "connector" && (
              <line
                x1={(byId.get(draft.from) as BoxItem).x + (byId.get(draft.from) as BoxItem).w / 2}
                y1={(byId.get(draft.from) as BoxItem).y + (byId.get(draft.from) as BoxItem).h / 2}
                x2={draft.to.x}
                y2={draft.to.y}
                className={styles.lineDraft}
                markerEnd={`url(#${markerRef(markerId, false, true)})`}
              />
            )}
          </svg>
          {items.map((item) =>
            item.type === "connector" ? (
              <ConnectorLabels
                key={item.id}
                item={item}
                points={connectorPoints_.get(item.id) ?? []}
                editing={editingText?.id === item.id && !readOnly ? editingText.field : null}
                onInput={(field, text) => editText(item.id, field, text)}
                onDone={() => finishEditing(item.id)}
                placeholder={t("labelPlaceholder")}
              />
            ) : item.type === "line" ? (
              <LineShape key={item.id} item={item} selected={selection.has(item.id)} markerId={markerId} />
            ) : (
              <Box
                key={item.id}
                item={item}
                selected={selection.has(item.id)}
                editing={editing === item.id && !readOnly}
                resizable={!readOnly && single?.id === item.id}
                textMovable={!readOnly && single?.id === item.id && editing !== item.id}
                moveTextLabel={t("moveText")}
                copyMark={!!drag?.alt && drag.moving.has(item.id)}
                onInput={(text) => editText(item.id, "text", text)}
                onDone={() => finishEditing(item.id)}
                placeholder={t("textPlaceholder")}
                resizeLabel={t("resize")}
                linkLabel={t("openLink")}
                onOpenLink={(id) => router.push(`/pages/${id}`)}
              />
            ),
          )}
          {guides.map((g, i) => (
            <div
              key={i}
              className={styles.guide}
              data-axis={g.axis}
              style={g.axis === "x" ? { left: g.at, top: g.from, height: g.to - g.from } : { left: g.from, top: g.at, width: g.to - g.from }}
              data-ui="Whiteboard.guide"
            />
          ))}
          {alignKeyBox && !readOnly && (
            <div
              className={styles.alignKey}
              style={{ left: alignKeyBox.x, top: alignKeyBox.y, width: alignKeyBox.w, height: alignKeyBox.h }}
              data-ui="Whiteboard.alignKey"
              data-id={alignKeyBox.id}
            />
          )}
          {drag?.ghosts.map((r, i) => (
            <div key={i} className={styles.ghost} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} data-ui="Whiteboard.dragOrigin" />
          ))}
          {dropTarget && isBox(byId.get(dropTarget.id)) ? (
            <ConnectDots box={byId.get(dropTarget.id) as BoxItem} label={t("connectFrom")} active={dropTarget.side} />
          ) : (
            hoveredBox && !drag && <ConnectDots box={hoveredBox} label={t("connectFrom")} active={null} />
          )}
          {endHandles && (
            <>
              {(["from", "to"] as const).map((end) => (
                <span
                  key={end}
                  className={styles.endHandle}
                  style={{ left: endHandles[end].x, top: endHandles[end].y }}
                  data-wb-end={end}
                  title={t("moveEnd")}
                  data-ui="Whiteboard.connectorEndHandle"
                  data-id={end}
                />
              ))}
            </>
          )}
          {lineHandles &&
            lineHandles.map((p, i) => (
              <span
                key={i}
                className={styles.endHandle}
                style={{ left: p.x, top: p.y }}
                data-wb-lineend={String(i + 1)}
                title={t("moveLineEnd")}
                data-ui="Whiteboard.lineEndHandle"
                data-id={String(i + 1)}
              />
            ))}
          {marquee && (
            <div
              className={styles.marquee}
              style={(() => {
                const r = rectFrom(marquee.a, marquee.b);
                return { left: r.x, top: r.y, width: r.w, height: r.h };
              })()}
            />
          )}
        </div>
        {cursors.map((c) => {
          const p = toScreen(camera, c);
          return (
            <div
              key={c.clientId}
              className={styles.cursor}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, ["--cursor-color" as string]: c.color }}
              data-ui="Whiteboard.cursor"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M1 1 L1 13 L4.5 9.5 L7 15 L9 14 L6.5 8.5 L11.5 8.5 Z" />
              </svg>
              {c.name && <span className={styles.cursorName}>{c.name}</span>}
            </div>
          );
        })}
        {items.length === 0 && (
          <p className={styles.empty} data-ui="Whiteboard.emptyStatus">
            {readOnly ? t("emptyReadOnly") : t("empty")}
          </p>
        )}
      </div>

      {!readOnly && (
        <div className={styles.toolbar} role="toolbar" aria-label={t("toolsLabel")} data-ui="Whiteboard.toolbar" data-wb-controls>
          {tools.map((x) => (
            <button
              key={x.tool}
              type="button"
              className={styles.toolButton}
              aria-pressed={tool === x.tool}
              aria-label={x.label}
              title={x.label}
              data-ui={`Whiteboard.${x.dataUi}`}
              onClick={() => {
                setTool(x.tool);
                viewportRef.current?.focus({ preventScroll: true });
              }}
            >
              <Icon name={x.icon} />
            </button>
          ))}
          <span className={styles.toolSeparator} />
          <div className={styles.templatePick} ref={templatesRef}>
            <button
              type="button"
              className={styles.toolButton}
              aria-label={t("templatesLabel")}
              title={t("templatesLabel")}
              aria-expanded={templatesOpen}
              aria-haspopup="menu"
              data-ui="Whiteboard.templatesButton"
              onClick={() => setTemplatesOpen(!templatesOpen)}
            >
              <Icon name="templates" />
            </button>
            {templatesOpen && (
              <div className={styles.templateMenu} role="menu" aria-label={t("templatesLabel")} data-ui="Whiteboard.templateMenu">
                {TEMPLATES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="menuitem"
                    className={styles.templateItem}
                    onClick={() => insertTemplate(name)}
                    data-ui="Whiteboard.templateItem"
                    data-id={name}
                  >
                    <span className={styles.templateName}>{t(`templates.${name}.name`)}</span>
                    <span className={styles.templateNote}>{t(`templates.${name}.note`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!readOnly && selection.size > 0 && (
        <div
          className={styles.selectionBar}
          role="toolbar"
          aria-label={t("selectionLabel")}
          data-ui="Whiteboard.selectionBar"
          data-wb-controls
          onClick={focusBoard}
        >
          {colorable && ITEM_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ background: `var(--color-wb-${color})` }}
              aria-label={t(`colors.${color}`)}
              title={t(`colors.${color}`)}
              aria-pressed={single ? single.color === color : undefined}
              data-ui="Whiteboard.colorButton"
              data-id={color}
              onClick={() => setColor(color)}
            />
          ))}
          {colorable && <span className={styles.separator} />}
          {shapeSelected && (
            <>
              {SHAPE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={styles.barButton}
                  aria-label={t(`shapes.${type}`)}
                  title={t(`shapes.${type}`)}
                  aria-pressed={isBox(single) ? single.type === type : undefined}
                  data-ui="Whiteboard.shapeButton"
                  data-id={type}
                  onClick={() => setShape(type)}
                >
                  <Icon name={type} size={18} />
                </button>
              ))}
              <span className={styles.separator} />
              <button
                type="button"
                className={styles.barButton}
                aria-label={t("bulletList")}
                title={t("bulletList")}
                data-ui="Whiteboard.bulletListButton"
                onClick={() => setList("bullet")}
              >
                <Icon name="bulletList" size={18} />
              </button>
              <button
                type="button"
                className={styles.barButton}
                aria-label={t("numberedList")}
                title={t("numberedList")}
                data-ui="Whiteboard.numberedListButton"
                onClick={() => setList("number")}
              >
                <Icon name="numberedList" size={18} />
              </button>
              {textMoved && (
                <button
                  type="button"
                  className={styles.barButton}
                  aria-label={t("resetTextPlace")}
                  title={t("resetTextPlace")}
                  data-ui="Whiteboard.resetTextButton"
                  onClick={resetTextPlace}
                >
                  <Icon name="resetText" size={18} />
                </button>
              )}
              <span className={styles.separator} />
            </>
          )}
          {selectedBoxes.length >= 2 && (
            <>
              {ALIGNMENTS.map((how) => (
                <button
                  key={how}
                  type="button"
                  className={styles.barButton}
                  aria-label={t(`align.${how}`)}
                  title={t(`align.${how}`)}
                  data-ui="Whiteboard.alignButton"
                  data-id={how}
                  onClick={() => placeBoxes(align(selectedBoxes, how, alignKey ?? undefined))}
                >
                  <Icon name={ALIGN_ICONS[how]} size={18} />
                </button>
              ))}
              {selectedBoxes.length >= 3 &&
                (["x", "y"] as const).map((axis) => (
                  <button
                    key={axis}
                    type="button"
                    className={styles.barButton}
                    aria-label={t(`distribute.${axis}`)}
                    title={t(`distribute.${axis}`)}
                    data-ui="Whiteboard.distributeButton"
                    data-id={axis}
                    onClick={() => placeBoxes(distribute(selectedBoxes, axis))}
                  >
                    <Icon name={ALIGN_ICONS[axis]} size={18} />
                  </button>
                ))}
              <span className={styles.separator} />
            </>
          )}
          {connectedBoxes.length > 0 && (
            <>
              {CONNECTOR_ENDS.map((ends) => (
                <button
                  key={ends}
                  type="button"
                  className={styles.barButton}
                  aria-label={t(`connectorEnds.${ends}`)}
                  title={t(`connectorEnds.${ends}`)}
                  aria-pressed={connectedBoxes.every((b) => b.connectorEnds === ends)}
                  data-ui="Whiteboard.connectorEndsButton"
                  data-id={ends}
                  onClick={() => setConnectorEnds(ends)}
                >
                  <Icon name={ENDS_ICONS[ends]} size={18} />
                </button>
              ))}
              <span className={styles.separator} />
            </>
          )}
          {singleBox && (
            <>
              <button
                type="button"
                className={styles.barButton}
                aria-label={singleBox.link ? t("changeLink") : t("link")}
                title={singleBox.link ? t("changeLink") : t("link")}
                data-ui="Whiteboard.linkButton"
                onClick={() => setLinking(singleBox.id)}
              >
                <Icon name="link" size={18} />
              </button>
              {singleBox.link && (
                <button
                  type="button"
                  className={styles.barButton}
                  aria-label={t("unlink")}
                  title={t("unlink")}
                  data-ui="Whiteboard.unlinkButton"
                  onClick={() => change(() => setField(singleBox.id, { link: "" }))}
                >
                  <Icon name="unlink" size={18} />
                </button>
              )}
              <span className={styles.separator} />
            </>
          )}
          {arrowsSelected && (
            <>
              {ARROW_ENDS.map((arrows) => (
                <button
                  key={arrows}
                  type="button"
                  className={styles.barButton}
                  aria-label={t(`arrows.${arrows}`)}
                  title={t(`arrows.${arrows}`)}
                  aria-pressed={hasArrows(single) ? single.arrows === arrows : undefined}
                  data-ui="Whiteboard.arrowsButton"
                  data-id={arrows}
                  onClick={() => setArrows(arrows)}
                >
                  <Icon name={ARROW_ICONS[arrows]} size={18} />
                </button>
              ))}
              <span className={styles.separator} />
              {STROKES.map((stroke) => (
                <button
                  key={stroke}
                  type="button"
                  className={styles.barButton}
                  aria-label={t(`strokes.${stroke}`)}
                  title={t(`strokes.${stroke}`)}
                  aria-pressed={hasArrows(single) ? single.stroke === stroke : undefined}
                  data-ui="Whiteboard.strokeButton"
                  data-id={stroke}
                  onClick={() => setStroke(stroke)}
                >
                  <Icon name={STROKE_ICONS[stroke]} size={18} />
                </button>
              ))}
              <span className={styles.separator} />
            </>
          )}
          {connectorSelected && (
            <>
              {ROUTES.map((route) => (
                <button
                  key={route}
                  type="button"
                  className={styles.barButton}
                  aria-label={t(`routes.${route}`)}
                  title={t(`routes.${route}`)}
                  aria-pressed={single?.type === "connector" ? single.route === route : undefined}
                  data-ui="Whiteboard.routeButton"
                  data-id={route}
                  onClick={() => setRoute(route)}
                >
                  <Icon name={ROUTE_ICONS[route]} size={18} />
                </button>
              ))}
              <span className={styles.separator} />
            </>
          )}
          <button
            type="button"
            className={styles.barButton}
            aria-label={t("bringToFront")}
            title={t("bringToFront")}
            data-ui="Whiteboard.frontButton"
            onClick={() => restack(true)}
          >
            <Icon name="bringToFront" size={18} />
          </button>
          <button
            type="button"
            className={styles.barButton}
            aria-label={t("sendToBack")}
            title={t("sendToBack")}
            data-ui="Whiteboard.backButton"
            onClick={() => restack(false)}
          >
            <Icon name="sendToBack" size={18} />
          </button>
          <button
            type="button"
            className={styles.barButton}
            aria-label={t("duplicate")}
            title={t("duplicate")}
            data-ui="Whiteboard.duplicateButton"
            onClick={duplicate}
          >
            <Icon name="duplicate" size={18} />
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            aria-label={t("delete")}
            title={t("delete")}
            data-ui="Whiteboard.deleteButton"
            onClick={() => removeItems(selection)}
          >
            <Icon name="delete" size={18} />
          </button>
        </div>
      )}

      <div className={styles.zoom} data-ui="Whiteboard.zoomControls" data-wb-controls onClick={focusBoard}>
        <button type="button" className={styles.barButton} aria-label={t("zoomOut")} title={t("zoomOut")} data-ui="Whiteboard.zoomOutButton" onClick={() => zoomBy(-1)}>
          <Icon name="zoomOut" size={18} />
        </button>
        <button
          type="button"
          className={styles.zoomValue}
          aria-label={t("zoomReset", { zoom: Math.round(camera.zoom * 100) })}
          title={t("zoomReset", { zoom: Math.round(camera.zoom * 100) })}
          data-ui="Whiteboard.zoomResetButton"
          onClick={() => zoomTo(() => 1)}
        >
          {Math.round(camera.zoom * 100)}%
        </button>
        <button type="button" className={styles.barButton} aria-label={t("zoomIn")} title={t("zoomIn")} data-ui="Whiteboard.zoomInButton" onClick={() => zoomBy(1)}>
          <Icon name="zoomIn" size={18} />
        </button>
        <button type="button" className={styles.barButton} aria-label={t("fit")} title={t("fit")} data-ui="Whiteboard.fitButton" onClick={fit}>
          <Icon name="fit" size={18} />
        </button>
        {!readOnly && (
          <button
            type="button"
            className={styles.barButton}
            aria-pressed={gridSnap}
            aria-label={t("gridSnap")}
            title={t("gridSnapHint")}
            data-ui="Whiteboard.gridSnapButton"
            onClick={toggleGridSnap}
          >
            <Icon name="grid" size={18} />
          </button>
        )}
        <button
          type="button"
          className={styles.barButton}
          data-ui="Whiteboard.fullscreenButton"
          aria-pressed={fullscreen}
          aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")}
          title={fullscreen ? t("exitFullscreenHint") : t("fullscreen")}
          onClick={() => setFullscreen((f) => !f)}
        >
          <Icon name={fullscreen ? "exitFullscreen" : "fullscreen"} size={18} />
        </button>
      </div>
      {linking && (
        <PagePickerDialog
          title={t("linkTitle")}
          lead={t("linkLead")}
          kind="any"
          exclude={pageId ?? null}
          onPick={(target) => change(() => setField(linking, { link: target }))}
          onClose={() => {
            setLinking(null);
            focusBoard();
          }}
        />
      )}
    </div>
  );
}


// A connector's chosen sides, as stored (none stored when not chosen).
const sideFields = (fromSide: Side | null, toSide: Side | null) => ({
  ...(fromSide && { fromSide }),
  ...(toSide && { toSide }),
});

// Items that have arrowheads to choose.
const hasArrows = (item: WhiteboardItem | undefined): item is ConnectorItem | LineItem =>
  item?.type === "connector" || item?.type === "line";

// A line's ends, `dx` and `dy` further on.
const movedLine = (l: LineEnds, dx: number, dy: number): LineEnds => ({
  x1: clampCoord(l.x1 + dx),
  y1: clampCoord(l.y1 + dy),
  x2: clampCoord(l.x2 + dx),
  y2: clampCoord(l.y2 + dy),
});

// The rectangles the items take up (for fitting the board on the screen).
const itemRects = (items: WhiteboardItem[]) =>
  items.flatMap((i) => (isBox(i) ? [i] : i.type === "line" ? [lineRect(i)] : []));

// A plain line, in its own SVG so it stacks among the boxes in order (the
// connectors' SVG lies under all of them).
function LineShape({ item, selected, markerId }: { item: LineItem; selected: boolean; markerId: string }) {
  const d = `M ${item.x1} ${item.y1} L ${item.x2} ${item.y2}`;
  return (
    <svg className={styles.lines} aria-hidden>
      <g data-wb-id={item.id} data-ui="Whiteboard.line" data-id={item.id} data-arrows={item.arrows} data-stroke={item.stroke}>
        <path d={d} className={styles.lineHit} />
        <StrokePaths d={d} stroke={item.stroke} arrows={item.arrows} selected={selected} markerId={markerId} />
      </g>
    </svg>
  );
}

// The arrowhead markers' ids (in the connectors' SVG): normal or large, in
// the line's color or the selection's.
const markerRef = (markerId: string, large: boolean, selected: boolean) =>
  `${markerId}-arrow${large ? "-large" : ""}${selected ? "-selected" : ""}`;

// A connector's or line's visible line, drawn in its stroke (STROKE_DRAW).
// A double line's arrowheads go on a last, unstroked path, over its middle.
function StrokePaths({ d, stroke, arrows, selected, markerId }: { d: string; stroke: Stroke; arrows: ArrowEnds; selected: boolean; markerId: string }) {
  const draw = STROKE_DRAW[stroke];
  const arrow = `url(#${markerRef(markerId, draw.large, selected)})`;
  const markers = {
    markerStart: arrows === "start" || arrows === "both" ? arrow : undefined,
    markerEnd: arrows === "end" || arrows === "both" ? arrow : undefined,
  };
  return (
    <>
      <path
        d={d}
        className={selected ? styles.lineSelected : styles.line}
        style={{ strokeWidth: draw.width, strokeDasharray: draw.dash }}
        {...(draw.gap ? {} : markers)}
      />
      {draw.gap && (
        <>
          <path d={d} className={styles.lineGap} style={{ strokeWidth: draw.gap }} />
          <path d={d} className={styles.lineGap} style={{ stroke: "none" }} {...markers} />
        </>
      )}
    </>
  );
}

// A connector's or line's stroke, as stored (none stored for the usual one).
const strokeField = (stroke: Stroke) => (stroke === "solid" ? {} : { stroke });

// Dots on the middle of each side of the box under the pointer: dragging
// one draws a connector from the box (like the connector tool).
// While a connector's end is dragged over a box, the side it would go to is
// marked (`active`).
function ConnectDots({ box, label, active }: { box: BoxItem; label: string; active: Side | null }) {
  const out = 12;
  const dots = {
    top: { left: box.x + box.w / 2, top: box.y, dx: 0, dy: -out },
    right: { left: box.x + box.w, top: box.y + box.h / 2, dx: out, dy: 0 },
    bottom: { left: box.x + box.w / 2, top: box.y + box.h, dx: 0, dy: out },
    left: { left: box.x, top: box.y + box.h / 2, dx: -out, dy: 0 },
  };
  return (
    <>
      {Object.entries(dots).map(([side, d]) => (
        <span
          key={side}
          className={side === active ? styles.connectDotActive : styles.connectDot}
          style={{
            left: d.left,
            top: d.top,
            ["--dx" as string]: d.dx,
            ["--dy" as string]: d.dy,
          }}
          data-wb-connect={box.id}
          title={label}
          data-ui="Whiteboard.connectHandle"
          data-id={side}
        />
      ))}
    </>
  );
}

// A sticky note, shape or text: its text, or a field for it while editing.
function Box({
  item,
  selected,
  editing,
  resizable,
  textMovable,
  moveTextLabel,
  copyMark,
  onInput,
  onDone,
  placeholder,
  resizeLabel,
  linkLabel,
  onOpenLink,
}: {
  item: BoxItem;
  selected: boolean;
  editing: boolean;
  resizable: boolean;
  // Shows the handle that moves the text.
  textMovable: boolean;
  moveTextLabel: string;
  // Being dragged with Alt held: letting go leaves a copy here.
  copyMark: boolean;
  onInput: (text: string) => void;
  onDone: () => void;
  placeholder: string;
  resizeLabel: string;
  linkLabel: string;
  onOpenLink: (pageId: string) => void;
}) {
  return (
    <div
      className={styles.box}
      data-type={item.type}
      data-selected={selected ? "" : undefined}
      style={{
        left: item.x,
        top: item.y,
        width: item.w,
        height: item.h,
        // An ellipse's or diamond's text stays inside its outline, not in
        // the corners of the box around it (a percentage would be of the
        // board's width).
        ...(item.type === "ellipse" && { paddingInline: Math.round(item.w * 0.15) }),
        ...(item.type === "diamond" && { paddingInline: Math.round(item.w * 0.22), paddingBlock: Math.round(item.h * 0.12) }),
        ["--item-color" as string]: `var(--color-wb-${item.color})`,
      }}
      data-wb-id={item.id}
      data-ui="Whiteboard.item"
      data-id={item.id}
    >
      {item.type === "diamond" && (
        <svg className={styles.diamond} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polygon points="50,0 100,50 50,100 0,50" />
        </svg>
      )}
      {item.type === "image" ? (
        item.src ? (
          // eslint-disable-next-line @next/next/no-img-element -- an attachment, served with an access check
          <img className={styles.image} src={resolveAppUrl(item.src)} alt="" draggable={false} data-ui="Whiteboard.image" />
        ) : (
          <span className={styles.imageMissing} aria-hidden>
            🖼
          </span>
        )
      ) : (
        <div
          className={styles.textPlace}
          style={item.textX || item.textY ? { transform: `translate(${item.textX}px, ${item.textY}px)` } : undefined}
        >
          {editing ? (
            <TextInput className={styles.boxInput} text={item.text} onInput={onInput} onDone={onDone} placeholder={placeholder} />
          ) : (
            <RichText className={styles.boxText} text={item.text} />
          )}
          {textMovable && (
            <span className={styles.textHandle} data-wb-textmove title={moveTextLabel} data-ui="Whiteboard.moveTextHandle" />
          )}
        </div>
      )}
      {item.link && (
        <a
          className={styles.linkBadge}
          href={`/pages/${item.link}`}
          title={linkLabel}
          aria-label={linkLabel}
          data-wb-link={item.link}
          data-ui="Whiteboard.linkBadge"
          onClick={(e) => {
            // Ctrl/⌘ or Shift + click: a new tab or window, as for any link.
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpenLink(item.link);
          }}
        >
          <Icon name="link" size="calc(14px / var(--zoom, 1))" />
        </a>
      )}
      {copyMark && (
        <span className={styles.copyMark} aria-hidden data-ui="Whiteboard.copyMark">
          +
        </span>
      )}
      {resizable && (
        <span className={styles.handle} data-wb-handle aria-label={resizeLabel} title={resizeLabel} data-ui="Whiteboard.resizeHandle" />
      )}
    </div>
  );
}

// A connector's texts: halfway along it, and by its start and end (each only
// shown when it has one, or while being edited).
function ConnectorLabels({
  item,
  points,
  editing,
  onInput,
  onDone,
  placeholder,
}: {
  item: ConnectorItem;
  points: Point[];
  // Which of its texts is being edited.
  editing: TextField | null;
  onInput: (field: TextField, text: string) => void;
  onDone: () => void;
  placeholder: string;
}) {
  if (points.length === 0) return null;
  // An end's text sits beside the line, not on it (endLabelPlace).
  const beside = (run: Point[]) => {
    const place = endLabelPlace(run);
    return { left: place.x, top: place.y, transform: place.side === "above" ? "translate(-50%, -100%)" : "translate(0, -50%)" };
  };
  const mid = midpointOf(points);
  const at: Record<TextField, CSSProperties> = {
    text: { left: mid.x, top: mid.y },
    startText: beside(points),
    endText: beside([...points].reverse()),
  };
  return (
    <>
      {(["startText", "text", "endText"] as const).map((field) =>
        editing !== field && !item[field] ? null : (
          <div
            key={field}
            className={field === "text" ? styles.label : styles.endLabel}
            style={at[field]}
            data-wb-id={item.id}
            data-wb-field={field}
            data-ui="Whiteboard.connectorLabel"
            data-id={field}
          >
            {editing === field ? (
              <TextInput
                className={styles.labelInput}
                text={item[field]}
                onInput={(text) => onInput(field, text)}
                onDone={onDone}
                placeholder={placeholder}
              />
            ) : (
              <RichText text={item[field]} />
            )}
          </div>
        ),
      )}
    </>
  );
}

// Text with its lists shown as lists (rich-text.ts).
function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {parseRichText(text).map((block, i) =>
        block.kind === "text" ? (
          <div key={i} className={styles.plainText}>
            {block.text}
          </div>
        ) : block.kind === "bullet" ? (
          <ul key={i} className={styles.list}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} className={styles.list} start={block.start}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

// Uncontrolled while it has focus, so someone else's edit (or an IME)
// doesn't move the caret; each change is written to the board as typed.
function TextInput({
  className,
  text,
  onInput,
  onDone,
  placeholder,
}: {
  className: string;
  text: string;
  onInput: (text: string) => void;
  onDone: () => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // As tall as its text (up to the item's height), so it sits where the
  // text is shown: centered from top to bottom.
  const fit = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    fit(el);
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className={className}
      defaultValue={text}
      maxLength={MAX_TEXT_LENGTH}
      placeholder={placeholder}
      spellCheck={false}
      data-ui="Whiteboard.textInput"
      rows={1}
      onChange={(e) => {
        fit(e.target);
        onInput(e.target.value);
      }}
      onBlur={onDone}
      onKeyDown={(e) => {
        // In a list, Enter starts the next item (or ends the list on an empty one).
        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing) {
          const el = e.currentTarget;
          const start = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
          const lineEnd = el.value.indexOf("\n", el.selectionStart);
          const line = el.value.slice(start, lineEnd === -1 ? undefined : lineEnd);
          const list = el.selectionStart === el.selectionEnd ? enterInList(line) : null;
          if (list) {
            e.preventDefault();
            if ("end" in list) el.setRangeText("", start, start + line.length, "end");
            else el.setRangeText(`\n${list.continue}`, el.selectionStart, el.selectionEnd, "end");
            fit(el);
            onInput(el.value);
            return;
          }
        }
        // Back to the board (its keys work again).
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          const board = e.currentTarget.closest<HTMLElement>("[role=application]");
          if (board) board.focus({ preventScroll: true });
          else e.currentTarget.blur();
        }
      }}
    />
  );
}
