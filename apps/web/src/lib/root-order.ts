// The order of knowledge roots in a sidebar: those in `order` (ids, first
// first) in that order, after the ones not in it, which come newest first —
// so a new root shows at the top. `trees` comes oldest first. Used for a
// signed-in user's own order (User.rootOrder) and for the public sidebar
// (InstanceConfig.publicRootOrder). No dependencies (unit tests:
// test/root-order.test.ts).
export function orderRoots<T extends { rootId: string }>(trees: T[], order: string[]): T[] {
  const position = new Map(order.map((id, i) => [id, i]));
  const unplaced = trees.filter((t) => !position.has(t.rootId)).reverse();
  const placed = trees.filter((t) => position.has(t.rootId)).sort((a, b) => position.get(a.rootId)! - position.get(b.rootId)!);
  return [...unplaced, ...placed];
}

// An order as saved: ids that look like ids, each once, at most `max`.
export function normalizeRootOrder(values: unknown[], max = 500): string[] | null {
  if (values.length > max || !values.every((v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v))) return null;
  return [...new Set(values as string[])];
}
