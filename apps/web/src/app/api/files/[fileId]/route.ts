import type { NextRequest } from "next/server";
import { getPageAccess, requestNetworkCaps } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getFile, getStorageConfig } from "@/lib/storage";
import { contentDisposition } from "@/lib/content-disposition";
import { parseByteRange } from "@/lib/byte-range";

// GET /api/files/<id>
// Serves an attachment to users who can view the page it was attached to
// (group grants). Anything else gets 404, so file ids can't be probed.

// Types a browser may render inline. Everything else — notably HTML, SVG and
// PDF, which can run script — is forced to download, so uploaded content
// can never execute on the app's origin.
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
]);

// The type of media a browser didn't name when it uploaded the file (some
// give no type for .mov / .m4v / .mkv): from the name, so it can still play.
const MEDIA_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
};

function servedType(mimeType: string, name: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && MEDIA_BY_EXTENSION[ext]) || mimeType;
}

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[fileId]">) {
  // Not logged in: files of public pages only (getPageAccess with null).
  const user = await getCurrentUser();
  const { fileId } = await ctx.params;

  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: { id: true, name: true, mimeType: true, pageId: true },
  });
  // A file whose page was deleted (pageId set to null) is no longer served.
  if (!file?.pageId || !(await getPageAccess(prisma, user?.id ?? null, file.pageId))) return notFound();
  // Downloads not allowed from this network (lib/network-policy.ts).
  if (!(await requestNetworkCaps()).download) {
    return new Response("Downloading files isn't allowed from this network", { status: 403 });
  }

  const config = await getStorageConfig();
  if (!config) return new Response("File storage is not configured", { status: 503 });

  let bytes: Buffer;
  try {
    bytes = await getFile(config, file.id);
  } catch (err) {
    console.error("[files] download failed", file.id, err);
    return new Response("File unavailable", { status: 502 });
  }

  const type = servedType(file.mimeType, file.name);
  const inline = INLINE_TYPES.has(type);
  const headers: Record<string, string> = {
    "Content-Type": inline ? type : "application/octet-stream",
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    // Per-user content: never in shared caches; short browser cache so
    // revoked access takes effect soon.
    "Cache-Control": "private, max-age=300",
  };

  // Part of the file: media players ask for ranges, and Safari (and iOS)
  // won't play a video at all without 206 answers.
  const range = parseByteRange(req.headers.get("range"), bytes.byteLength);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.byteLength}` } });
  }
  if (range) {
    const part = bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(part), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(part.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
      },
    });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
}
