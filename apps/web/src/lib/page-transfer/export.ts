import { createHash, randomBytes } from "node:crypto";
import * as Y from "yjs";
import { type VisiblePage, atLeast, loadDataKey, openEmail } from "shared";
import { prisma } from "@/lib/db";
import { getPageAccess, getVisibleTree } from "@/lib/page-access";
import { currentPageState } from "@/lib/api/page-content";
import { getApiSettings } from "@/lib/api/keys";
import { openColumn, openValue } from "@/lib/page-properties";
import { openNote } from "@/lib/presentation-history";
import { referencedFileIds } from "@/lib/search-index";
import { getFile, getStorageConfig } from "@/lib/storage";
import { getPublicUrl } from "@/lib/site-url";
import { recordAudit, userLabel } from "@/lib/audit";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { withEmail } from "@/lib/emails";
import {
  MAX_TRANSFER_FILES,
  MAX_TRANSFER_PAGES,
  type TransferBundle,
  type TransferFile,
  type TransferPage,
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  peopleIn,
  personHash,
  rebuildDoc,
} from "./format";

// The exporting side of a copy (lib/page-transfer/): a one-time link to a
// page and the pages under it, as the one who made it sees them.
//
// The link is made through the API or MCP by someone who can see the page
// (createPageExport). The site the pages go to fetches it once (takeExport):
// the pages are read then, with the access the link's maker has at that
// moment (and only while the API is on and they may still use it), so a page
// they can no longer see isn't in it. Its attachments are fetched next
// (exportFile), until the link expires: only those the pages show and the
// maker can open. Whoever has the link gets the pages, like a shared file.

export const EXPORT_TOKEN_PREFIX = "knx_";
export const EXPORT_TTL_MS = 10 * 60 * 1000;
export const EXPORT_PATH = "/api/v1/exports";
const TOKEN = /^knx_[A-Za-z0-9_-]{43}$/;

export const isExportToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ExportError = "not_found" | "slide" | "too_many_pages";

// The pages a link takes: the page and those under it the user sees, each
// after its parent, siblings in their order. A slide goes with its
// presentation, never on its own.
async function subtree(userId: string, pageId: string): Promise<{ pages: VisiblePage[]; rootId: string } | { error: ExportError }> {
  const access = await getPageAccess(prisma, userId, pageId);
  if (!access) return { error: "not_found" as const };
  // Someone else's personal root: an auditor may view it page by page, each
  // view logged (lib/personal-root-audit.ts), never take it away whole.
  const root = await prisma.knowledgeRoot.findUnique({ where: { id: access.rootId }, select: { ownerId: true } });
  if (root?.ownerId && root.ownerId !== userId) return { error: "not_found" as const };
  const tree = await getVisibleTree(prisma, userId, access.rootId, { slides: true });
  const top = tree?.pages.find((p) => p.id === pageId);
  if (!tree || !top) return { error: "not_found" as const };
  if (top.kind === "SLIDE") return { error: "slide" as const };
  const children = new Map<string, typeof tree.pages>();
  for (const p of tree.pages) {
    if (!p.parentId) continue;
    const list = children.get(p.parentId) ?? [];
    list.push(p);
    children.set(p.parentId, list);
  }
  const pages = [top];
  for (let i = 0; i < pages.length; i++) {
    // Nothing under a shortcut or a slide (and none can be there).
    if (pages[i].kind === "SHORTCUT" || pages[i].kind === "SLIDE") continue;
    for (const child of children.get(pages[i].id) ?? []) {
      pages.push(child);
      if (pages.length > MAX_TRANSFER_PAGES) return { error: "too_many_pages" as const };
    }
  }
  return { pages, rootId: access.rootId };
}

export async function createPageExport(
  userId: string,
  pageId: string,
  via: "api" | "mcp",
): Promise<{ url: string; expiresAt: Date; pages: number } | { error: ExportError }> {
  const found = await subtree(userId, pageId);
  if ("error" in found) return { error: found.error };
  const token = EXPORT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
  await prisma.pageExport.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.pageExport.create({ data: { tokenHash: hashToken(token), userId, pageId, expiresAt } });

  // Content leaves the site's control: kept in the audit log.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, emailEnc: true } });
  const audit = await auditTranslator();
  const top = found.pages[0];
  const summary = (title: string) => audit("audit.pageExport", { title, descendants: found.pages.length - 1, via });
  await recordAudit(
    { userId, label: user ? userLabel(await withEmail(user)) : "" },
    "page.export",
    summary(displayTitleWith(audit)(top.title)),
    { pageId, descendants: found.pages.length - 1, via },
    summary(audit("audit.hiddenPage")),
  );
  return { url: `${await getPublicUrl()}${EXPORT_PATH}/${token}`, expiresAt, pages: found.pages.length };
}

// Whether the link's maker may still hand pages out through the API.
async function makerMayExport(userId: string): Promise<boolean> {
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true, siteRole: true } }),
    getApiSettings(),
  ]);
  return !!user && !user.disabledAt && settings.enabled && settings.roles.includes(user.siteRole);
}

// The pages of a link, once: null for an unknown, expired or used link (or
// one whose maker can't export any more, or can't see the page now).
export async function takeExport(token: string): Promise<TransferBundle | null> {
  if (!isExportToken(token)) return null;
  const row = await prisma.pageExport.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.fetchedAt || row.expiresAt < new Date()) return null;
  // Taken by one request only.
  const taken = await prisma.pageExport.updateMany({ where: { id: row.id, fetchedAt: null }, data: { fetchedAt: new Date() } });
  if (taken.count !== 1 || !(await makerMayExport(row.userId))) return null;
  const bundle = await buildBundle(row.userId, row.pageId);
  if (!bundle) return null;
  await prisma.pageExport.update({ where: { id: row.id }, data: { fileIds: bundle.files.map((f) => f.id) } });
  return bundle;
}

// One attachment of a link taken already, until it expires.
export async function exportFile(token: string, fileId: string): Promise<{ name: string; mimeType: string; bytes: Uint8Array } | null> {
  if (!isExportToken(token)) return null;
  const row = await prisma.pageExport.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row?.fetchedAt || row.expiresAt < new Date() || !row.fileIds.includes(fileId)) return null;
  if (!(await makerMayExport(row.userId))) return null;
  const file = await prisma.fileObject.findUnique({ where: { id: fileId }, select: { name: true, mimeType: true, pageId: true } });
  // Still one the maker can open.
  if (!file?.pageId || !(await getPageAccess(prisma, row.userId, file.pageId))) return null;
  const config = await getStorageConfig();
  if (!config) return null;
  try {
    return { name: file.name, mimeType: file.mimeType, bytes: await getFile(config, fileId) };
  } catch (err) {
    console.error("[page-transfer] reading an attachment failed", fileId, err);
    return null;
  }
}

export async function buildBundle(userId: string, pageId: string): Promise<TransferBundle | null> {
  const found = await subtree(userId, pageId);
  if ("error" in found) return null;
  const key = await loadDataKey(prisma);
  const salt = randomBytes(24).toString("base64url");
  const ids = new Set(found.pages.map((p) => p.id));
  const parentOf = new Map(found.pages.map((p) => [p.id, p.parentId]));

  const [defs, values, settings, notes] = await Promise.all([
    prisma.pagePropertyDef.findMany({ where: { pageId: { in: [...ids] } }, orderBy: { position: "asc" } }),
    prisma.pagePropertyValue.findMany({ where: { pageId: { in: [...ids] } }, include: { def: { select: { pageId: true, type: true } } } }),
    prisma.presentationSettings.findMany({ where: { pageId: { in: [...ids] } } }),
    prisma.slideNote.findMany({ where: { slideId: { in: [...ids] } } }),
  ]);
  const people = new Set<string>();
  const fileIds: string[] = [];
  const pages: TransferPage[] = [];

  for (const p of found.pages) {
    let state: string | null = null;
    if (p.kind !== "SHORTCUT") {
      const stored = await currentPageState(p.id);
      if (stored) {
        const source = new Y.Doc();
        Y.applyUpdate(source, stored);
        const copy = rebuildDoc(source);
        for (const id of referencedFileIds(copy)) if (!fileIds.includes(id)) fileIds.push(id);
        for (const id of peopleIn(copy)) people.add(id);
        state = Buffer.from(Y.encodeStateAsUpdate(copy)).toString("base64");
        source.destroy();
        copy.destroy();
      }
    }
    const presentation = settings.find((s) => s.pageId === p.id);
    // Speaker notes go to those who can edit the presentation only.
    const deck = p.kind === "SLIDE" ? found.pages.find((d) => d.id === p.parentId) : undefined;
    const note = deck && atLeast(deck.access, "EDIT") ? notes.find((n) => n.slideId === p.id) : undefined;
    pages.push({
      id: p.id,
      parentId: p.id === pageId ? null : p.parentId,
      kind: p.kind,
      title: p.title,
      shortcutTargetId: p.kind === "SHORTCUT" ? p.shortcutTargetId : null,
      state,
      columns: defs
        .filter((d) => d.pageId === p.id)
        .map((d) => {
          const column = openColumn(key, d);
          return { id: d.id, type: d.type, name: column.name, options: column.options, position: d.position };
        }),
      // Only in the columns of a parent that's in the copy.
      values: values
        .filter((v) => v.pageId === p.id && p.id !== pageId && v.def.pageId === parentOf.get(p.id))
        .map((v) => {
          const value = openValue(key, v);
          if (v.def.type === "USER" && value) people.add(value);
          return { defId: v.defId, value };
        }),
      presentation:
        p.kind === "PRESENTATION" && presentation
          ? {
              numberingEnabled: presentation.numberingEnabled,
              numberStart: presentation.numberStart,
              numberPosition: presentation.numberPosition,
              hiddenSlideIds: presentation.hiddenSlideIds.filter((id) => ids.has(id)),
              numberHiddenSlideIds: presentation.numberHiddenSlideIds.filter((id) => ids.has(id)),
            }
          : null,
      note: note ? openNote(key, p.id, note.textEnc) : null,
    });
  }

  // The attachments the pages show that the maker can open.
  const rows = await prisma.fileObject.findMany({
    where: { id: { in: fileIds.slice(0, MAX_TRANSFER_FILES * 2) } },
    select: { id: true, name: true, mimeType: true, size: true, pageId: true },
  });
  const canOpen = new Map<string, boolean>();
  const files: TransferFile[] = [];
  for (const id of fileIds) {
    const row = rows.find((r) => r.id === id);
    if (!row?.pageId || files.length >= MAX_TRANSFER_FILES) continue;
    if (!canOpen.has(row.pageId)) canOpen.set(row.pageId, ids.has(row.pageId) || !!(await getPageAccess(prisma, userId, row.pageId)));
    if (!canOpen.get(row.pageId)) continue;
    files.push({ id, name: row.name, mimeType: row.mimeType, size: row.size, pageId: ids.has(row.pageId) ? row.pageId : null });
  }

  const users = await prisma.user.findMany({ where: { id: { in: [...people] } }, select: { id: true, emailEnc: true } });
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    site: await getPublicUrl(),
    exportedAt: new Date().toISOString(),
    salt,
    pages,
    files,
    people: [...people].map((id) => {
      const emailEnc = users.find((u) => u.id === id)?.emailEnc;
      return { id, emailHash: emailEnc ? personHash(salt, openEmail(key, emailEnc)) : null };
    }),
  };
}
