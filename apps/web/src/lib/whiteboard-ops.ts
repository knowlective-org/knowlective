import * as Y from "yjs";
import {
  BOX_TYPES,
  MAX_ITEMS,
  PAGE_ID,
  type WhiteboardItem,
  isBox,
  isShapeType,
  readItem,
  whiteboardMap,
} from "./whiteboard";

// Changes to a whiteboard from outside the board's screen (the public API,
// /api/v1/pages/<id>/whiteboard): items added, fields of items changed,
// items removed, all at once. planWhiteboardChange() checks a request
// against the board as it is and turns it into plain operations;
// applyWhiteboardOps() makes them on a document. Both sides apply them with
// their own Yjs (the Next.js bundle checks on a copy, the collab server
// changes the live document), so only plain data goes between them.
// Depends on Yjs and lib/whiteboard.ts only (unit tests: test/whiteboard-ops.test.ts).

export type WhiteboardOps = {
  // Fields to set on an item (null: take the field away), creating it if new.
  set: { id: string; fields: Record<string, string | number | null> }[];
  remove: string[];
};

export const MAX_OPS = 1000;

// The fields that can be written, by kind of item. (`type` too: a shape's
// can change into another shape, the others' can't change.)
const BOX_FIELDS = ["x", "y", "w", "h", "text", "textX", "textY", "color", "z", "src", "link", "connectorEnds"];
const CONNECTOR_FIELDS = ["from", "to", "arrows", "route", "stroke", "fromSide", "toSide", "text", "startText", "endText", "color", "z"];
const LINE_FIELDS = ["x1", "y1", "x2", "y2", "arrows", "stroke", "color", "z"];

const fieldsOf = (type: string) =>
  type === "connector" ? CONNECTOR_FIELDS : type === "line" ? LINE_FIELDS : (BOX_TYPES as readonly string[]).includes(type) ? BOX_FIELDS : null;

export function applyWhiteboardOps(doc: Y.Doc, ops: WhiteboardOps): void {
  const map = whiteboardMap(doc);
  for (const { id, fields } of ops.set) {
    let item = map.get(id);
    if (!(item instanceof Y.Map)) {
      item = new Y.Map<unknown>();
      map.set(id, item);
    }
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) item.delete(key);
      else item.set(key, value);
    }
  }
  for (const id of ops.remove) map.delete(id);
}

type Fail = { error: string };
const fail = (error: string): Fail => ({ error });

// The value an item shows for a field, as readItem() reads it (null-ish
// fields compared as the "missing" value).
function shown(item: WhiteboardItem, key: string): unknown {
  return (item as Record<string, unknown>)[key];
}

// `input`: { add?: item[], update?: { id, ...fields }[], remove?: id[] }.
// `newId` names added items that don't bring an id. Returns the operations
// and the ids of the added items (in order), or what's wrong (English, for
// the API's message).
export function planWhiteboardChange(
  doc: Y.Doc,
  input: unknown,
  newId: () => string,
): { ops: WhiteboardOps; added: string[] } | Fail {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("Send { add, update, remove }.");
  const { add = [], update = [], remove = [] } = input as Record<string, unknown>;
  if (!Array.isArray(add) || !Array.isArray(update) || !Array.isArray(remove)) {
    return fail("\"add\", \"update\" and \"remove\" must be arrays.");
  }
  if (add.length + update.length + remove.length === 0) return fail("Nothing to change.");
  if (add.length + update.length + remove.length > MAX_OPS) return fail(`At most ${MAX_OPS} changes at once.`);

  const map = whiteboardMap(doc);
  const ops: WhiteboardOps = { set: [], remove: [] };
  const added: string[] = [];
  const touched = new Set<string>();
  let topZ = Math.max(0, ...[...map.values()].map((m) => (m instanceof Y.Map && typeof m.get("z") === "number" ? (m.get("z") as number) : 0)));

  const checkFields = (where: string, type: string, raw: Record<string, unknown>): { fields: Record<string, string | number | null> } | Fail => {
    const allowed = fieldsOf(type);
    if (!allowed) return fail(`${where}: unknown type "${type}".`);
    const fields: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "id" || key === "type") continue;
      if (!allowed.includes(key)) return fail(`${where}: a ${type} has no field "${key}".`);
      if (value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
        return fail(`${where}: "${key}" must be a string, a number or null.`);
      }
      fields[key] = value as string | number | null;
    }
    return { fields };
  };

  for (const [i, raw] of add.entries()) {
    const where = `add[${i}]`;
    if (!raw || typeof raw !== "object") return fail(`${where}: an item must be an object.`);
    const item = raw as Record<string, unknown>;
    const id = item.id === undefined ? newId() : item.id;
    if (typeof id !== "string" || !PAGE_ID.test(id)) return fail(`${where}: "id" must be 1-64 letters, digits, "-" or "_".`);
    if (map.has(id) || touched.has(id)) return fail(`${where}: an item "${id}" is already there.`);
    if (typeof item.type !== "string") return fail(`${where}: "type" is required.`);
    const checked = checkFields(where, item.type, item);
    if ("error" in checked) return checked;
    const { fields } = checked;
    if (fields.z === undefined) fields.z = ++topZ;
    ops.set.push({ id, fields: { type: item.type, ...fields } });
    touched.add(id);
    added.push(id);
  }

  for (const [i, raw] of update.entries()) {
    const where = `update[${i}]`;
    if (!raw || typeof raw !== "object") return fail(`${where}: must be an object.`);
    const patch = raw as Record<string, unknown>;
    const id = patch.id;
    const existing = typeof id === "string" ? map.get(id) : undefined;
    const pending = ops.set.find((s) => s.id === id);
    if (typeof id !== "string" || (!(existing instanceof Y.Map) && !pending)) return fail(`${where}: no item "${String(id)}".`);
    const currentType = String(pending?.fields.type ?? (existing as Y.Map<unknown>).get("type"));
    let type = currentType;
    if (patch.type !== undefined && patch.type !== currentType) {
      if (typeof patch.type !== "string" || !isShapeType(patch.type) || !isShapeType(currentType)) {
        return fail(`${where}: only a sticky note, rectangle, ellipse, diamond or text can change its type, into another of those.`);
      }
      type = patch.type;
    }
    const checked = checkFields(where, type, patch);
    if ("error" in checked) return checked;
    const { fields } = checked;
    if (type !== currentType) fields.type = type;
    if (pending) Object.assign(pending.fields, fields);
    else ops.set.push({ id, fields });
    touched.add(id);
  }

  for (const [i, id] of remove.entries()) {
    if (typeof id !== "string" || (!map.has(id) && !touched.has(id))) return fail(`remove[${i}]: no item "${String(id)}".`);
    ops.remove.push(id);
  }

  // Tried on a copy: every item changed must read back as written, and the
  // board stay within its limits. Connectors of removed boxes go with them.
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  applyWhiteboardOps(copy, ops);
  const after = whiteboardMap(copy);
  const removed = new Set(ops.remove);
  for (const [id, value] of after) {
    if (removed.has(id) || !(value instanceof Y.Map) || value.get("type") !== "connector") continue;
    if (removed.has(String(value.get("from"))) || removed.has(String(value.get("to")))) {
      ops.remove.push(id);
      after.delete(id);
    }
  }
  if (after.size > MAX_ITEMS) return fail(`A whiteboard can hold up to ${MAX_ITEMS} items.`);
  for (const { id, fields } of ops.set) {
    if (removed.has(id)) continue;
    const value = after.get(id);
    const item = value instanceof Y.Map ? readItem(id, value) : null;
    if (!item) return fail(`Item "${id}" isn't valid (a connector needs "from" and "to", two different boxes).`);
    for (const [key, written] of Object.entries(fields)) {
      if (key === "type" || written === null) continue;
      if (shown(item, key) !== written) return fail(`Item "${id}": "${key}" can't be ${JSON.stringify(written)}.`);
    }
    if (item.type === "connector") {
      for (const end of [item.from, item.to]) {
        const box = after.get(end);
        const target = box instanceof Y.Map ? readItem(end, box) : null;
        if (!isBox(target ?? undefined)) return fail(`Connector "${id}": "${end}" isn't a box on the board.`);
      }
    }
    if (isBox(item) && fields.link !== undefined && fields.link !== null && fields.link !== "" && !PAGE_ID.test(String(fields.link))) {
      return fail(`Item "${id}": "link" must be a page id.`);
    }
  }
  return { ops, added };
}

// The attachments (file ids) the change puts on the board as images.
export function imageFileIds(ops: WhiteboardOps): string[] {
  return ops.set.flatMap(({ fields }) => (typeof fields.src === "string" && fields.src ? [fields.src.slice("/api/files/".length)] : []));
}
