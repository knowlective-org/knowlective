import * as Y from "yjs";

// Saved page versions as differences. A version is either whole (`baseId`
// null) or what changed since the version it's based on; every
// CHECKPOINT_EVERY versions one is whole again, so reading one applies only
// a few, and a damaged row can't reach far. Whole versions from before this
// existed stay as they are. Only Yjs: the collab server, the app and the unit
// tests.

export const CHECKPOINT_EVERY = 20;

export type VersionRow = { id: string; baseId: string | null; state: Uint8Array };

// A version's whole state. `open` decrypts a row. Applied to a document (not
// merged as updates) so that text deleted along the way is really gone from
// the result, as in a whole version.
export async function versionState(
  id: string,
  load: (id: string) => Promise<VersionRow | null>,
  open: (row: VersionRow) => Uint8Array,
): Promise<Uint8Array> {
  const chain: VersionRow[] = [];
  for (let next: string | null = id; next; ) {
    if (chain.length > CHECKPOINT_EVERY) throw new Error("Version chain too long");
    const row: VersionRow | null = await load(next);
    if (!row) throw new Error("Version chain broken");
    chain.push(row);
    next = row.baseId;
  }
  if (chain.length === 1) return open(chain[0]);
  const doc = new Y.Doc();
  try {
    for (const row of chain.reverse()) Y.applyUpdate(doc, open(row));
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

// What to store for a new version of `document`: the difference from `base`
// (the page's latest version, whole) when that's possible and smaller, else
// the whole state. The difference is applied and compared before it's trusted.
export function encodeVersion(
  document: Y.Doc,
  base: { id: string; depth: number; state: Uint8Array } | null,
): { state: Uint8Array; baseId: string | null; depth: number } {
  const whole = Y.encodeStateAsUpdate(document);
  const asWhole = { state: whole, baseId: null, depth: 0 };
  if (!base || base.depth + 1 >= CHECKPOINT_EVERY) return asWhole;
  const replay = new Y.Doc();
  try {
    Y.applyUpdate(replay, base.state);
    const diff = Y.encodeStateAsUpdate(document, Y.encodeStateVector(replay));
    if (diff.length >= whole.length) return asWhole;
    Y.applyUpdate(replay, diff);
    if (!Y.equalSnapshots(Y.snapshot(replay), Y.snapshot(document))) return asWhole;
    return { state: diff, baseId: base.id, depth: base.depth + 1 };
  } catch {
    return asWhole;
  } finally {
    replay.destroy();
  }
}
