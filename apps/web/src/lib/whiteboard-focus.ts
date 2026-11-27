import { GROUP_ID, type WhiteboardItem, isBox, isGroupable } from "./whiteboard";

// A part of a whiteboard: what a whiteboard block in a document shows
// (its `focus` property), and what's exported from a selection. Groups are
// kept by their id, so items put in the group later are part of it too;
// other items by theirs (one deleted is simply no longer shown). Connectors
// between two boxes shown are shown with them. Unit tests:
// test/whiteboard-focus.test.ts.

export type WhiteboardFocus = { items: string[]; groups: string[] };

// Ids in a property are at most this many (a board has at most MAX_ITEMS).
const MAX_IDS = 5_000;

// The block's property (from the shared document: checked). "" or anything
// that isn't a part: null, the whole board.
export function parseFocus(raw: unknown): WhiteboardFocus | null {
  if (typeof raw !== "string" || !raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const ids = (list: unknown) =>
    Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === "string" && GROUP_ID.test(id)))].slice(0, MAX_IDS) : [];
  const v = value as { items?: unknown; groups?: unknown };
  const focus = { items: ids(v.items), groups: ids(v.groups) };
  return focus.items.length || focus.groups.length ? focus : null;
}

export const serializeFocus = (focus: WhiteboardFocus | null): string => (focus ? JSON.stringify(focus) : "");

// The part a selection makes: a group whose items are all selected is kept
// as the group, the rest one by one. Nothing (or only connectors, which
// show only with their boxes): null.
export function focusFromSelection(items: WhiteboardItem[], selected: Iterable<string>): WhiteboardFocus | null {
  const chosen = new Set(selected);
  const groups = new Map<string, boolean>();
  for (const item of items) {
    if (!isGroupable(item) || !item.group) continue;
    groups.set(item.group, (groups.get(item.group) ?? true) && chosen.has(item.id));
  }
  const whole = new Set([...groups].filter(([, all]) => all).map(([group]) => group));
  const out: WhiteboardFocus = { items: [], groups: [...whole] };
  for (const item of items) {
    if (!chosen.has(item.id) || item.type === "connector") continue;
    if (isGroupable(item) && whole.has(item.group)) continue;
    out.items.push(item.id);
  }
  return out.items.length || out.groups.length ? out : null;
}

// The items of the part, in the board's order (back to front); null: all.
export function focusedItems(items: WhiteboardItem[], focus: WhiteboardFocus | null): WhiteboardItem[] {
  if (!focus) return items;
  const ids = new Set(focus.items);
  const groups = new Set(focus.groups);
  const shown = new Set(
    items.filter((i) => i.type !== "connector" && (ids.has(i.id) || (isGroupable(i) && !!i.group && groups.has(i.group)))).map((i) => i.id),
  );
  const boxes = new Set(items.filter((i) => isBox(i) && shown.has(i.id)).map((i) => i.id));
  return items.filter((i) => (i.type === "connector" ? boxes.has(i.from) && boxes.has(i.to) : shown.has(i.id)));
}

// Grouping items (Ctrl/⌘+G) with a whole group among them keeps that
// group's id (the first such, in the selection's order), so a part that
// shows the group shows what's put in it. None: null (a new group).
export function groupToJoin(items: WhiteboardItem[], selected: string[]): string | null {
  const chosen = new Set(selected);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of selected) {
    const item = byId.get(id);
    if (!isGroupable(item) || !item.group) continue;
    const group = item.group;
    if (items.every((i) => !isGroupable(i) || i.group !== group || chosen.has(i.id))) return group;
  }
  return null;
}

// A link to items of a whiteboard page: the part in the address's query
// (`?items=a,b&groups=g`), which the board opens at, the items picked.
export function focusSearch(focus: WhiteboardFocus): string {
  const params = new URLSearchParams();
  if (focus.items.length) params.set("items", focus.items.join(","));
  if (focus.groups.length) params.set("groups", focus.groups.join(","));
  return params.toString();
}

// The part a link names (anyone can write the address: checked as the
// block's property is). None: null.
export function focusFromSearch(params: URLSearchParams): WhiteboardFocus | null {
  const list = (name: string) => (params.get(name) ?? "").split(",").filter(Boolean);
  return parseFocus(JSON.stringify({ items: list("items"), groups: list("groups") }));
}
