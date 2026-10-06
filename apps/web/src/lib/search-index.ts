import { createHmac, hkdfSync } from "node:crypto";
import * as Y from "yjs";
import { decrypt, loadDataKey, type PrismaClient } from "shared";
import { normalizeTitle } from "./page-title";

// Encrypted full-text search index. Used by the collab server (reindexing on
// every store) and the app (queries, reindexing on uploads / new pages).
//
// A page's text (title, body, attachment names) is normalized (NFKC, lower
// case) and cut into every 1- and 2-character piece. Each piece becomes a
// 64-bit HMAC under a key derived from the data key, and only those numbers
// are stored (PageSearchIndex.tokens, GIN-indexed). A query is cut and hashed
// the same way; pages whose tokens contain all of the query's are candidates,
// which are then decrypted to confirm the match. Someone with the database
// but not the key can't read the text — though pages sharing pieces of text
// share tokens, which leaks some structure.

const SEARCH_KEY_INFO = "yosuga:search-index:v1";

export function searchKey(dataKey: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", dataKey, Buffer.alloc(0), SEARCH_KEY_INFO, 32));
}

// Normalized text as code points, each remembering where it came from in
// the original string (for snippets). Whitespace runs become one space.
export function normalizeWithMap(text: string): { chars: string[]; origin: number[] } {
  const chars: string[] = [];
  const origin: number[] = [];
  let offset = 0;
  for (const cp of Array.from(text)) {
    const normalized = /\s/.test(cp) ? " " : cp.normalize("NFKC").toLowerCase();
    for (const ch of Array.from(normalized)) {
      if (ch === " " && chars[chars.length - 1] === " ") continue;
      chars.push(ch);
      origin.push(offset);
    }
    offset += cp.length;
  }
  return { chars, origin };
}

export const normalizeForSearch = (text: string) => normalizeWithMap(text).chars.join("");

// Every 1- and 2-character piece without whitespace.
function pieces(text: string): Set<string> {
  const chars = normalizeWithMap(text).chars;
  const out = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === " ") continue;
    out.add(chars[i]);
    if (i + 1 < chars.length && chars[i + 1] !== " ") out.add(chars[i] + chars[i + 1]);
  }
  return out;
}

function token(key: Buffer, piece: string): bigint {
  return createHmac("sha256", key).update(piece).digest().readBigInt64BE(0);
}

export function tokensFor(key: Buffer, text: string): bigint[] {
  return [...pieces(text)].map((p) => token(key, p));
}

// Search terms (split on whitespace) and the tokens a page must contain for
// all of them: a 1-character term needs that character, a longer one all of
// its 2-character pieces.
export function queryTokens(key: Buffer, query: string): { terms: string[]; tokens: bigint[] } {
  const terms = normalizeForSearch(query).split(" ").filter(Boolean);
  const set = new Set<string>();
  for (const term of terms) {
    const chars = Array.from(term);
    if (chars.length === 1) set.add(term);
    else for (let i = 0; i + 1 < chars.length; i++) set.add(chars[i] + chars[i + 1]);
  }
  return { terms, tokens: [...set].map((p) => token(key, p)) };
}

// Plain text of a page body (BlockNote's Yjs fragment): text runs in
// document order, one line per block.
export function documentText(doc: Y.Doc): string {
  const lines: string[] = [];
  let line = "";
  const visit = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment) => {
    if (node instanceof Y.XmlText) {
      for (const op of node.toDelta() as { insert: unknown }[]) if (typeof op.insert === "string") line += op.insert;
      return;
    }
    for (const child of node.toArray()) visit(child as Y.XmlElement | Y.XmlText);
    if (node instanceof Y.XmlElement && node.nodeName === "blockContainer" && line) {
      lines.push(line);
      line = "";
    }
  };
  visit(doc.getXmlFragment("blocknote"));
  if (line) lines.push(line);
  return lines.join("\n");
}

export type PageSearchText = { title: string; body: string; files: string[] };

// Title, body and attachment names of a page. `state` is the document's Yjs
// state if the caller has it (the collab server); otherwise the stored one.
export async function pageSearchText(prisma: PrismaClient, pageId: string, state?: Uint8Array): Promise<PageSearchText | null> {
  const [page, files, stored] = await Promise.all([
    prisma.page.findUnique({ where: { id: pageId }, select: { title: true } }),
    prisma.fileObject.findMany({ where: { pageId }, select: { name: true }, orderBy: { createdAt: "asc" } }),
    state ? null : prisma.pageDocument.findUnique({ where: { pageId }, select: { state: true } }),
  ]);
  if (!page) return null;
  let body = "";
  let title = page.title;
  const update = state ?? (stored ? decrypt(await loadDataKey(prisma), stored.state, pageId) : null);
  if (update) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    body = documentText(doc);
    // The live title can be ahead of Page.title (mirrored on store).
    title = normalizeTitle(doc.getText("title").toString()) || title;
  }
  return { title, body, files: files.map((f) => f.name) };
}

// Rebuilds a page's index row. Never throws: search falling behind must not
// break saving.
export async function reindexPage(prisma: PrismaClient, pageId: string, state?: Uint8Array): Promise<void> {
  try {
    const text = await pageSearchText(prisma, pageId, state);
    if (!text) return;
    const key = searchKey(await loadDataKey(prisma));
    const tokens = tokensFor(key, [text.title, text.body, ...text.files].join("\n"));
    await prisma.pageSearchIndex.upsert({
      where: { pageId },
      create: { pageId, tokens, indexedAt: new Date() },
      update: { tokens, indexedAt: new Date() },
    });
  } catch (err) {
    console.error("[search] indexing failed for a page", err);
  }
}

// Pages whose index is missing or older than their content (e.g. after this
// feature was added, or edits while indexing failed). Run in the background
// at server start.
export async function reindexStalePages(prisma: PrismaClient): Promise<number> {
  const pages = await prisma.page.findMany({
    select: {
      id: true,
      updatedAt: true,
      document: { select: { updatedAt: true } },
      searchIndex: { select: { indexedAt: true } },
      files: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  let count = 0;
  for (const p of pages) {
    const changed = Math.max(
      p.updatedAt.getTime(),
      p.document?.updatedAt.getTime() ?? 0,
      p.files[0]?.createdAt.getTime() ?? 0,
    );
    if (p.searchIndex && p.searchIndex.indexedAt.getTime() >= changed) continue;
    await reindexPage(prisma, p.id);
    count++;
  }
  return count;
}
