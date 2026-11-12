import * as Y from "yjs";
import { Prisma, canEditPage } from "shared";
import { prisma } from "@/lib/db";
import { fileUploaded } from "@/lib/file-search";
import { fileIdOf, fileUrl } from "@/lib/file-url";
import { getPageAccess, requestNetworkCaps } from "@/lib/page-access";
import { getPublicUrl } from "@/lib/site-url";
import {
  getAllowedUploadExtensions,
  getFile,
  getMaxUploadSizeMb,
  getStorageConfig,
  getUploadsEnabled,
  putFile,
} from "@/lib/storage";
import { isUploadAllowed } from "@/lib/upload-types";

// Attachments in a block copied from another page. A file is served to those
// who can open the page it was uploaded on (FileObject.pageId,
// app/api/files/[fileId]/route.ts), so a block copied from, say, someone's
// own root showed its file to them only: everyone else got 404. The file
// becomes the page's own instead: a copy, made when someone who can edit the
// page and open the file's page has it open (the editor asks with the ids it
// finds, components/editor/adopt-files.ts) or writes it through the API.
// One copy per page and source (FileObject.copiedFromId), so two editors
// fixing the same block at once end up with the same URL.
//
// A copy shows the file to everyone who can open this page, and the file
// may have been put here by someone who can't open it themselves: the editor
// asks first (`copy` false: what would be copied, in `pending`), and copies
// only once the person whose access it uses says so.

// At most this many files per request.
export const MAX_ADOPT_FILES = 50;

// Per id asked: the URL the page should use ("/api/files/<id>"; the same
// one for a file that is the page's own already), or null when it stays as it
// is (no such file, not allowed, too large, the storage failing).
export type AdoptedFiles = Record<string, string | null>;

// `urls`: as above; `pending`: files that would be copied, when not copying
// (their urls are null meanwhile).
export type AdoptResult = { urls: AdoptedFiles; pending: { id: string; name: string }[] };

export async function adoptFiles(userId: string, pageId: string, fileIds: unknown, copy = true): Promise<AdoptResult> {
  const none: AdoptResult = { urls: {}, pending: [] };
  if (typeof pageId !== "string" || !Array.isArray(fileIds)) return none;
  const ids = [...new Set(fileIds.filter((id): id is string => typeof id === "string" && fileIdOf(fileUrl(id)) === id))].slice(
    0,
    MAX_ADOPT_FILES,
  );
  if (ids.length === 0) return none;
  const page = await getPageAccess(prisma, userId, pageId);
  if (!page || !canEditPage(page)) return none;

  const files = await prisma.fileObject.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, mimeType: true, size: true, pageId: true },
  });
  const result: AdoptedFiles = Object.fromEntries(ids.map((id) => [id, null]));
  const others = [];
  for (const file of files) {
    if (file.pageId === pageId) result[file.id] = fileUrl(file.id);
    else if (file.pageId) others.push({ ...file, pageId: file.pageId });
  }
  const pending: AdoptResult["pending"] = [];
  const done = () => ({ urls: result, pending });
  if (others.length === 0) return done();

  // Copied already (by someone else, or a block pasted twice).
  const copies = await prisma.fileObject.findMany({
    where: { pageId, copiedFromId: { in: others.map((f) => f.id) } },
    select: { id: true, copiedFromId: true },
  });
  for (const copy of copies) if (copy.copiedFromId) result[copy.copiedFromId] = fileUrl(copy.id);

  const toCopy = others.filter((f) => !result[f.id]);
  if (toCopy.length === 0) return done();
  // A copy adds a file to the page: the same rules as an upload
  // (app/api/files/route.ts), and reading the source is a download.
  const caps = await requestNetworkCaps();
  if (!caps.upload || !caps.download || !(await getUploadsEnabled())) return done();
  const config = await getStorageConfig();
  if (!config) return done();
  const allowed = await getAllowedUploadExtensions();
  const maxBytes = (await getMaxUploadSizeMb()) * 1024 * 1024;

  for (const source of toCopy) {
    if (source.size > maxBytes || !isUploadAllowed(source.name, allowed)) continue;
    // Only who can open the file can copy it.
    if (!(await getPageAccess(prisma, userId, source.pageId))) continue;
    if (!copy) pending.push({ id: source.id, name: source.name });
    else result[source.id] = await copyFile(config, userId, { pageId, rootId: page.rootId }, source);
  }
  return done();
}

type StorageConfig = NonNullable<Awaited<ReturnType<typeof getStorageConfig>>>;

async function copyFile(
  config: StorageConfig,
  userId: string,
  page: { pageId: string; rootId: string },
  source: { id: string; name: string; mimeType: string; size: number },
): Promise<string | null> {
  let id: string;
  try {
    ({ id } = await prisma.fileObject.create({
      data: {
        rootId: page.rootId,
        pageId: page.pageId,
        uploadedById: userId,
        name: source.name,
        mimeType: source.mimeType,
        size: source.size,
        copiedFromId: source.id,
      },
      select: { id: true },
    }));
  } catch (err) {
    // Copied at the same moment by someone else.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const copy = await prisma.fileObject.findUnique({
      where: { pageId_copiedFromId: { pageId: page.pageId, copiedFromId: source.id } },
      select: { id: true },
    });
    return copy && fileUrl(copy.id);
  }
  try {
    const bytes = await getFile(config, source.id);
    await putFile(config, id, bytes);
    // Its text for search is read again (it's encrypted for its own id).
    fileUploaded(id, bytes);
    return fileUrl(id);
  } catch (err) {
    await prisma.fileObject.delete({ where: { id } }).catch(() => {});
    console.error("[files] copying an attachment failed", source.id, err);
    return null;
  }
}

// A body written through the API (a Yjs update from lib/markdown-bridge.ts):
// its attachments of other pages become the page's own, and the absolute URLs
// the Markdown export writes go back to "/api/files/<id>" (the form the
// pages keep, which search and the clean-up of unused files look for).
export async function adoptFilesInBody(userId: string, pageId: string, body: Uint8Array): Promise<Uint8Array> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, body);
  const siteUrl = await getPublicUrl();
  const found: { node: Y.XmlElement; id: string }[] = [];
  const visit = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      const id = fileIdOf(child.getAttribute("url"), siteUrl);
      if (id) found.push({ node: child, id });
      visit(child);
    }
  };
  visit(doc.getXmlFragment("blocknote"));
  if (found.length === 0) return body;
  // Put here by the caller themselves: copied without asking.
  const adopted = (await adoptFiles(userId, pageId, found.map((f) => f.id))).urls;
  doc.transact(() => {
    for (const { node, id } of found) node.setAttribute("url", adopted[id] ?? fileUrl(id));
  });
  return Y.encodeStateAsUpdate(doc);
}
