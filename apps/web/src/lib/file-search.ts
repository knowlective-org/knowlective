import { encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { MAX_EXTRACT_BYTES, extractFileText } from "@/lib/file-text";
import { fileTextAad, reindexPage } from "@/lib/search-index";
import { getFile, getStorageConfig } from "@/lib/storage";

// Attachments' text in search: read once per file (lib/file-text.ts), kept
// encrypted on its FileObject, and indexed with the page that shows the file
// (lib/search-index.ts; a file whose block was removed drops out).
//
// New uploads are read right after the upload (fileUploaded()); files from
// before this, or whose reading was cut short, by a background pass started
// with the server (instrumentation.ts). One file at a time: a large PDF
// takes memory and CPU.

let queue: Promise<void> = Promise.resolve();

function enqueue(job: () => Promise<void>): Promise<void> {
  queue = queue.then(job).catch((err) => console.error("[search] reading an attachment failed", err));
  return queue;
}

async function readAndIndex(fileId: string, bytes?: Uint8Array): Promise<void> {
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: { name: true, mimeType: true, size: true, pageId: true },
  });
  if (!file) return;
  let text: string | null = null;
  if (file.size <= MAX_EXTRACT_BYTES) {
    let content = bytes;
    if (!content) {
      const config = await getStorageConfig();
      if (!config) return; // Storage not set up: try again on a later pass.
      content = await getFile(config, fileId);
    }
    text = await extractFileText(file.name, file.mimeType, content);
  }
  await prisma.fileObject.update({
    where: { id: fileId },
    data: {
      textEnc: text
        ? Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(text, "utf8"), fileTextAad(fileId)))
        : null,
      textExtractedAt: new Date(),
    },
  });
  if (text && file.pageId) await reindexPage(prisma, file.pageId);
}

// After an upload, with the plaintext the route already has. Not awaited by
// the upload: the person doesn't wait for the file to be read.
export function fileUploaded(fileId: string, bytes: Uint8Array): void {
  void enqueue(() => readAndIndex(fileId, bytes));
}

const PASS_INTERVAL_MS = 30_000;
const FILES_PER_PASS = 5;

// The background pass over files not read yet (once per server).
export function startFileTextBackfill(): void {
  const flag = Symbol.for("knowlective.file-text-backfill");
  const g = globalThis as Record<symbol, unknown>;
  if (g[flag]) return;
  g[flag] = true;
  const pass = async () => {
    try {
      const files = await prisma.fileObject.findMany({
        where: { textExtractedAt: null },
        orderBy: { createdAt: "desc" },
        take: FILES_PER_PASS,
        select: { id: true },
      });
      for (const f of files) await enqueue(() => readAndIndex(f.id));
    } catch (err) {
      console.error("[search] the attachment pass failed", err);
    } finally {
      setTimeout(pass, PASS_INTERVAL_MS).unref();
    }
  };
  setTimeout(pass, 5_000).unref();
}
