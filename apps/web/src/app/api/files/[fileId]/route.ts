import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getFile, getStorageConfig } from "@/lib/storage";

// GET /api/files/<id>
// Serves an attachment to members of its knowledge root only. Anything else
// gets 404, so file ids can't be probed.

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
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
]);

const notFound = () => new Response("Not found", { status: 404 });

function contentDisposition(kind: "inline" | "attachment", name: string): string {
  // ASCII fallback + RFC 5987 UTF-8 name.
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[fileId]">) {
  const user = await getCurrentUser();
  if (!user) return notFound();
  const { fileId } = await ctx.params;

  const file = await prisma.fileObject.findFirst({
    where: { id: fileId, root: { members: { some: { userId: user.id } } } },
    select: { id: true, name: true, mimeType: true },
  });
  if (!file) return notFound();

  const config = await getStorageConfig();
  if (!config) return new Response("File storage is not configured", { status: 503 });

  let bytes: Buffer;
  try {
    bytes = await getFile(config, file.id);
  } catch (err) {
    console.error("[files] download failed", file.id, err);
    return new Response("File unavailable", { status: 502 });
  }

  const inline = INLINE_TYPES.has(file.mimeType);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? file.mimeType : "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      // Per-user content: never in shared caches; short browser cache so
      // revoked access takes effect soon.
      "Cache-Control": "private, max-age=300",
    },
  });
}
