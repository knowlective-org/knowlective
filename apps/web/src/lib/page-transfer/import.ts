import { randomBytes } from "node:crypto";
import * as Y from "yjs";
import { MAX_PAGE_DEPTH, type PageKind, atLeast, encrypt, loadDataKey, openEmail } from "shared";
import { prisma } from "@/lib/db";
import { getPageAccess, requestNetworkCaps } from "@/lib/page-access";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { nextSortOrder } from "@/lib/page-move";
import { normalizeTitle } from "@/lib/page-title";
import { pageAudienceIds } from "@/lib/page-people";
import { MAX_COLUMNS, normalizeColumnName, normalizeOptions, sealColumnName, sealOptions, sealValue, validateValue } from "@/lib/page-properties";
import type { PropertyColumn } from "@/lib/page-property-types";
import { MAX_SLIDES, isNumberPosition, isNumberStart } from "@/lib/presentation";
import { MAX_NOTE_LENGTH, sealNote } from "@/lib/presentation-history";
import { docNotices } from "@/lib/doc-notices";
import { referencedFileIds, reindexPage } from "@/lib/search-index";
import { fileUploaded } from "@/lib/file-search";
import { fetchChecked } from "@/lib/link-preview";
import { loadOutboundProxy } from "@/lib/outbound-proxy";
import { getPublicUrl } from "@/lib/site-url";
import { getAllowedUploadExtensions, getMaxUploadSizeMb, getStorageConfig, getUploadsEnabled, putFile } from "@/lib/storage";
import { isUploadAllowed } from "@/lib/upload-types";
import { recordAudit, userLabel } from "@/lib/audit";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { withEmail } from "@/lib/emails";
import { EXPORT_PATH, exportFile, isExportToken, takeExport } from "./export";
import {
  type BundleProblem,
  MAX_BUNDLE_BYTES,
  type Remap,
  type TransferBundle,
  type TransferPage,
  parseBundle,
  personHash,
  rebuildState,
} from "./format";

// The importing side of a copy (lib/page-transfer/): the pages of a
// one-time link (lib/page-transfer/export.ts), from another site or from
// this one, put under a page here as new pages, with the same rules as
// creating pages and attaching files.
//
// - Pages: each as its own page here (new ids), in the same tree and order,
//   last under the page they go to. The parent's EDIT is needed, as for
//   creating a page, and a lock that covers its child pages stops it.
// - Documents: as they were (block ids, block locks, whiteboards, slides),
//   rebuilt with the new ids of the pages, columns and files copied along
//   (lib/page-transfer/format.ts). Links to pages outside the copy stay as
//   they are: on another site, they open nothing.
// - Attachments: fetched and stored as the new pages' own, under the rules of
//   an upload here (files on, the network, the allowed extensions, the size
//   limit). One that can't be is left out: its block keeps the old URL.
// - People (another site's): the account here with the same address, among
//   those who can open the page the copy goes under; otherwise the mention is
//   removed and the TODO has nobody. On this site, they stay.
// - Notifications: none for what was there already (the TODOs and mentions
//   are recorded as seen, server/notifications.ts).

export type ImportError =
  | { code: "not_allowed" }
  | { code: "locked" }
  | { code: "not_here" }
  | { code: "too_deep" }
  | { code: "bad_url" }
  | { code: "unreachable"; status?: number }
  | { code: "bundle"; problem: BundleProblem }
  | { code: "too_many_slides" };

export type ImportResult = {
  pageId: string;
  pages: number;
  files: { copied: number; skipped: { name: string; reason: FileSkip }[] };
  // People named in the pages that the copy couldn't name here.
  peopleRemoved: number;
  sameSite: boolean;
};

type FileSkip = "uploads_off" | "type" | "too_large" | "unreachable";

const URL_PATTERN = new RegExp(`^(.*)${EXPORT_PATH.replace(/\//g, "\\/")}\\/(knx_[A-Za-z0-9_-]{43})$`);
const MIME = /^[\w.+-]{1,100}\/[\w.+-]{1,100}$/;

// An id for a new row, in the form Prisma gives (a cuid's length and letters).
const newId = () => {
  const bytes = randomBytes(24);
  return "c" + Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
};

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "file").slice(0, 255);
}

type Source = {
  sameSite: boolean;
  bundle: () => Promise<TransferBundle | ImportError>;
  file: (id: string, maxBytes: number) => Promise<Uint8Array | null>;
};

// Where a link's pages come from: this site itself, read in place, or another
// one, fetched with the checks of a link preview (lib/link-preview.ts).
async function sourceOf(raw: string): Promise<Source | ImportError> {
  const match = typeof raw === "string" && raw.length < 2000 ? URL_PATTERN.exec(raw.trim()) : null;
  if (!match || !isExportToken(match[2])) return { code: "bad_url" };
  const [, base, token] = match;
  if (base === (await getPublicUrl())) {
    return {
      sameSite: true,
      // Read like another site's, so both ways go through the same checks.
      bundle: async () => {
        const taken = await takeExport(token);
        if (!taken) return { code: "unreachable", status: 404 };
        const bundle = parseBundle(JSON.parse(JSON.stringify(taken)));
        return "problem" in bundle ? { code: "bundle", problem: bundle.problem } : bundle;
      },
      file: async (id, maxBytes) => {
        const file = await exportFile(token, id);
        return file && file.bytes.length <= maxBytes ? file.bytes : null;
      },
    };
  }
  const config = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { pageImportAllowPrivate: true } });
  const options = { allowPrivate: config.pageImportAllowPrivate, proxy: await loadOutboundProxy(prisma) };
  const url = `${base}${EXPORT_PATH}/${token}`;
  return {
    sameSite: false,
    bundle: async () => {
      const response = await fetchChecked(url, options, MAX_BUNDLE_BYTES, "application/json");
      if (!response) return { code: "unreachable" };
      if (response.status !== 200 || !/^application\/json\b/i.test(response.contentType)) return { code: "unreachable", status: response.status };
      let json: unknown;
      try {
        json = JSON.parse(response.body.toString("utf8"));
      } catch {
        return { code: "bundle", problem: "format" };
      }
      const bundle = parseBundle(json);
      return "problem" in bundle ? { code: "bundle", problem: bundle.problem } : bundle;
    },
    file: async (id, maxBytes) => {
      const response = await fetchChecked(`${url}/files/${encodeURIComponent(id)}`, options, maxBytes, "*/*");
      return response?.status === 200 ? new Uint8Array(response.body) : null;
    },
  };
}

// The levels of pages under the top one (0: the top page alone).
function bundleDepth(pages: TransferPage[]): number {
  const depth = new Map<string, number>();
  let max = 0;
  for (const p of pages) {
    const d = p.parentId ? (depth.get(p.parentId) ?? 0) + 1 : 0;
    depth.set(p.id, d);
    max = Math.max(max, d);
  }
  return max;
}

// Depth of a page (root page = 0), walked over its root's tree.
async function depthOf(rootId: string, pageId: string): Promise<number> {
  const tree = await prisma.page.findMany({ where: { rootId }, select: { id: true, parentId: true } });
  const parentOf = new Map(tree.map((p) => [p.id, p.parentId]));
  let depth = 0;
  for (let cursor = parentOf.get(pageId) ?? null; cursor; cursor = parentOf.get(cursor) ?? null) {
    if (++depth >= MAX_PAGE_DEPTH) break;
  }
  return depth;
}

// The accounts here that another site's people are, by address: only among
// those who can open the page the copy goes under.
async function matchPeople(bundle: TransferBundle, parentId: string): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>(bundle.people.map((p) => [p.id, null]));
  const wanted = new Set(bundle.people.flatMap((p) => (p.emailHash ? [p.emailHash] : [])));
  if (wanted.size === 0) return result;
  const candidates = await prisma.user.findMany({
    where: { id: { in: await pageAudienceIds(prisma, parentId) }, disabledAt: null, emailEnc: { not: null } },
    select: { id: true, emailEnc: true },
  });
  const key = await loadDataKey(prisma);
  const byHash = new Map<string, string>();
  for (const user of candidates) {
    const hash = personHash(bundle.salt, openEmail(key, user.emailEnc!));
    if (wanted.has(hash)) byHash.set(hash, user.id);
  }
  for (const person of bundle.people) if (person.emailHash) result.set(person.id, byHash.get(person.emailHash) ?? null);
  return result;
}

export async function importPages(
  userId: string,
  parentId: string,
  link: string,
  via: "api" | "mcp",
): Promise<ImportResult | ImportError> {
  const target = await getPageAccess(prisma, userId, parentId);
  if (!target || !atLeast(target.access, "EDIT")) return { code: "not_allowed" };
  if (target.lock?.coversChildren) return { code: "locked" };
  const parentRow = await prisma.page.findUniqueOrThrow({ where: { id: parentId }, select: { kind: true, title: true } });
  if (parentRow.kind !== "DOCUMENT" && parentRow.kind !== "WHITEBOARD") return { code: "not_here" };

  const source = await sourceOf(link);
  if ("code" in source) return source;
  const bundle = await source.bundle();
  if ("code" in bundle) return bundle;
  const { pages } = bundle;

  if ((await depthOf(target.rootId, parentId)) + 1 + bundleDepth(pages) > MAX_PAGE_DEPTH) return { code: "too_deep" };
  const slidesIn = new Map<string, number>();
  for (const p of pages) if (p.kind === "SLIDE" && p.parentId) slidesIn.set(p.parentId, (slidesIn.get(p.parentId) ?? 0) + 1);
  if ([...slidesIn.values()].some((n) => n > MAX_SLIDES)) return { code: "too_many_slides" };

  // New ids for everything copied along.
  const ids = new Map<string, string>();
  for (const p of pages) ids.set(p.id, newId());
  const columnIds = new Map<string, string>();
  for (const p of pages) for (const c of p.columns) columnIds.set(c.id, newId());
  const people = source.sameSite ? new Map<string, string | null>() : await matchPeople(bundle, parentId);

  // The pages, in one go, the top one last under the parent.
  const topOrder = await nextSortOrder(parentId);
  const siblingCount = new Map<string, number>();
  const rows = pages.map((p) => {
    const parent = p.parentId ? ids.get(p.parentId)! : parentId;
    const sortOrder = p.parentId ? (siblingCount.get(parent) ?? 0) : topOrder;
    siblingCount.set(parent, sortOrder + 1);
    return {
      id: ids.get(p.id)!,
      title: p.kind === "SLIDE" ? "" : normalizeTitle(p.title),
      kind: p.kind as PageKind,
      shortcutTargetId: p.kind === "SHORTCUT" && p.shortcutTargetId ? (ids.get(p.shortcutTargetId) ?? p.shortcutTargetId) : null,
      rootId: target.rootId,
      parentId: parent,
      sortOrder,
      createdById: userId,
    };
  });
  await prisma.page.createMany({ data: rows });

  // Attachments, as the new pages' own.
  const fileIds = new Map<string, string>();
  const skipped: ImportResult["files"]["skipped"] = [];
  // A file of a page that isn't in the copy goes to the first page showing it.
  const firstPageOf = new Map<string, string>();
  for (const p of pages) {
    if (!p.state) continue;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Buffer.from(p.state, "base64"));
      for (const id of referencedFileIds(doc)) if (!firstPageOf.has(id)) firstPageOf.set(id, p.id);
    } catch {
      // Not readable: left out below as well.
    } finally {
      doc.destroy();
    }
  }
  if (bundle.files.length > 0) {
    const caps = await requestNetworkCaps();
    const config = await getStorageConfig();
    const on = caps.upload && (await getUploadsEnabled()) && !!config;
    const allowed = await getAllowedUploadExtensions();
    const maxBytes = (await getMaxUploadSizeMb()) * 1024 * 1024;
    for (const file of bundle.files) {
      const name = safeFileName(file.name);
      if (!on || !config) {
        skipped.push({ name, reason: "uploads_off" });
        continue;
      }
      if (!isUploadAllowed(name, allowed)) {
        skipped.push({ name, reason: "type" });
        continue;
      }
      if (file.size > maxBytes) {
        skipped.push({ name, reason: "too_large" });
        continue;
      }
      const bytes = await source.file(file.id, maxBytes);
      if (!bytes) {
        skipped.push({ name, reason: "unreachable" });
        continue;
      }
      const owner = ids.get(file.pageId ?? "") ?? ids.get(firstPageOf.get(file.id) ?? pages[0].id)!;
      const id = newId();
      await prisma.fileObject.create({
        data: {
          id,
          rootId: target.rootId,
          pageId: owner,
          uploadedById: userId,
          name,
          mimeType: MIME.test(file.mimeType) ? file.mimeType : "application/octet-stream",
          size: bytes.length,
        },
      });
      try {
        await putFile(config, id, bytes);
      } catch (err) {
        await prisma.fileObject.delete({ where: { id } }).catch(() => {});
        console.error("[page-transfer] storing an attachment failed", err);
        skipped.push({ name, reason: "unreachable" });
        continue;
      }
      fileIds.set(file.id, id);
      fileUploaded(id, bytes);
    }
  }

  const remap: Remap = { ids: new Map([...ids, ...columnIds, ...fileIds]), people };
  const key = await loadDataKey(prisma);

  for (const p of pages) {
    const pageId = ids.get(p.id)!;
    let state: Uint8Array | null = null;
    if (p.state) {
      try {
        state = rebuildState(Buffer.from(p.state, "base64"), remap);
      } catch (err) {
        console.error("[page-transfer] a copied document couldn't be read", err);
      }
    }
    if (state) {
      await prisma.pageDocument.create({ data: { pageId, state: Uint8Array.from(encrypt(key, state, pageId)) } });
      // What's on the page now isn't news to anyone (server/notifications.ts).
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      const { todos, mentions } = docNotices(doc);
      doc.destroy();
      await prisma.$transaction([
        prisma.pageTodoItem.createMany({
          data: todos.map((t) => ({ pageId, blockId: t.blockId, assigneeId: t.assigneeId, due: t.due, checked: t.checked })),
          skipDuplicates: true,
        }),
        prisma.pageMention.createMany({ data: mentions.map((m) => ({ pageId, userId: m.userId })), skipDuplicates: true }),
        prisma.pageNotifyIndex.create({ data: { pageId } }),
      ]);
    }
  }

  // Columns of child page tables, and the values of the pages under them.
  const columnsOf = new Map<string, PropertyColumn[]>();
  for (const p of pages) {
    const pageId = ids.get(p.id)!;
    const columns: PropertyColumn[] = [];
    for (const c of p.columns.slice(0, MAX_COLUMNS)) {
      const name = normalizeColumnName(c.name);
      const options = c.type === "SELECT" ? normalizeOptions(c.options) : [];
      if (!name || !options) continue;
      const id = columnIds.get(c.id)!;
      await prisma.pagePropertyDef.create({
        data: {
          id,
          pageId,
          type: c.type,
          name: sealColumnName(key, id, name),
          options: c.type === "SELECT" ? sealOptions(key, id, options) : null,
          position: c.position,
        },
      });
      columns.push({ id: c.id, type: c.type, name, options });
    }
    columnsOf.set(p.id, columns);
  }
  const users = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: pages.flatMap((p) => p.values.map((v) => (people.has(v.value) ? (people.get(v.value) ?? "") : v.value))) } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  for (const p of pages) {
    if (!p.parentId) continue;
    const columns = columnsOf.get(p.parentId) ?? [];
    const pageId = ids.get(p.id)!;
    for (const v of p.values) {
      const column = columns.find((c) => c.id === v.defId);
      if (!column) continue;
      const value = column.type === "USER" && people.has(v.value) ? (people.get(v.value) ?? "") : v.value;
      if (value === "" || !validateValue(column, value, (id) => users.has(id))) continue;
      const defId = columnIds.get(column.id)!;
      await prisma.pagePropertyValue.create({ data: { pageId, defId, value: sealValue(key, pageId, defId, value) } });
    }
  }

  // Presentations' settings and their slides' notes.
  for (const p of pages) {
    const pageId = ids.get(p.id)!;
    if (p.kind === "PRESENTATION") {
      const s = p.presentation;
      const slides = (list: string[] | undefined) => (list ?? []).flatMap((id) => (pages.some((q) => q.id === id && q.parentId === p.id) ? [ids.get(id)!] : []));
      await prisma.presentationSettings.create({
        data: {
          pageId,
          numberingEnabled: s?.numberingEnabled ?? false,
          numberStart: s && isNumberStart(s.numberStart) ? s.numberStart : 1,
          numberPosition: s && isNumberPosition(s.numberPosition) ? s.numberPosition : "right",
          hiddenSlideIds: slides(s?.hiddenSlideIds),
          numberHiddenSlideIds: slides(s?.numberHiddenSlideIds),
        },
      });
    }
    if (p.kind === "SLIDE" && p.note && p.note.length <= MAX_NOTE_LENGTH) {
      await prisma.slideNote.create({ data: { slideId: pageId, textEnc: sealNote(key, pageId, p.note), updatedById: userId } });
    }
  }

  // Findable right away; the files they show, the linked views (search-index.ts).
  for (const p of pages) await reindexPage(prisma, ids.get(p.id)!);
  notifyChildrenChanged(parentId);

  const topId = ids.get(pages[0].id)!;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, emailEnc: true } });
  const audit = await auditTranslator();
  const title = displayTitleWith(audit);
  const summary = (page: string, under: string) =>
    audit("audit.pageImport", { title: page, to: under, descendants: pages.length - 1, site: source.sameSite ? "__empty__" : bundle.site, via });
  await recordAudit(
    { userId, label: user ? userLabel(await withEmail(user)) : "" },
    "page.import",
    summary(title(normalizeTitle(pages[0].title)), title(parentRow.title)),
    { pageId: topId, toParentId: parentId, descendants: pages.length - 1, site: bundle.site, via },
    summary(audit("audit.hiddenPage"), audit("audit.hiddenPage")),
  );

  return {
    pageId: topId,
    pages: pages.length,
    files: { copied: fileIds.size, skipped },
    peopleRemoved: [...people.values()].filter((v) => v === null).length,
    sameSite: source.sameSite,
  };
}
