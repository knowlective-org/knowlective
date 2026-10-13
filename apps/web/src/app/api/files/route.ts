import type { NextRequest } from "next/server";
import { atLeast } from "shared";
import { prisma } from "@/lib/db";
import { reindexPage } from "@/lib/search-index";
import { findAccessiblePage } from "@/lib/auth/pages";
import { getCurrentUser } from "@/lib/auth/session";
import { getAllowedUploadExtensions, getMaxUploadSizeMb, getStorageConfig, putFile } from "@/lib/storage";
import { isUploadAllowed, uploadRefusedMessage } from "@/lib/upload-types";

// POST /api/files?pageId=<id>  (multipart, field "file")
// Upload from the editor (BlockNote's uploadFile). Returns { url }.

const json = (status: number, body: object) => Response.json(body, { status });

// Route Handlers get no built-in CSRF check (Server Actions do). The session
// cookie is SameSite=Lax already; also refuse any cross-origin request.
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Strip path parts and control characters; keep it to a sane length.
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "file").slice(0, 255);
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return json(403, { error: "不正なリクエストです。" });

  const user = await getCurrentUser();
  if (!user) return json(401, { error: "ログインしてください。" });

  const pageId = req.nextUrl.searchParams.get("pageId");
  const page = pageId ? await findAccessiblePage(user.id, pageId) : null;
  if (!page) return json(404, { error: "ページが見つかりません。" });
  if (!atLeast(page.access, "EDIT")) return json(403, { error: "閲覧のみの権限ではファイルを追加できません。" });
  if (page.lock) return json(423, { error: "このページはロックされているため、ファイルを追加できません。" });

  const config = await getStorageConfig();
  if (!config) return json(503, { error: "ファイル保存が設定されていません。管理者に連絡してください。" });

  const maxMb = await getMaxUploadSizeMb();
  const maxBytes = maxMb * 1024 * 1024;
  const tooLarge = { error: `ファイルが大きすぎます（上限 ${maxMb}MB）。` };
  // Reject before reading the body when the client already says it's too big
  // (small allowance for the multipart framing).
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes + 64 * 1024) return json(413, tooLarge);

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return json(400, { error: "ファイルを読み取れませんでした。" });
  }
  if (!(file instanceof File)) return json(400, { error: "ファイルが送られていません。" });
  if (file.size > maxBytes) return json(413, tooLarge);
  // The editor checks this too, but only this check counts.
  if (!isUploadAllowed(file.name, await getAllowedUploadExtensions())) {
    return json(415, { error: uploadRefusedMessage(file.name) });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The row comes first: its id is the object key and the encryption AAD.
  const record = await prisma.fileObject.create({
    data: {
      rootId: page.root.id,
      pageId: page.id,
      uploadedById: user.id,
      name: safeFileName(file.name),
      mimeType: (file.type || "application/octet-stream").slice(0, 255),
      size: bytes.byteLength,
    },
    select: { id: true },
  });
  try {
    await putFile(config, record.id, bytes);
  } catch (err) {
    await prisma.fileObject.delete({ where: { id: record.id } });
    console.error("[files] upload failed", err);
    return json(502, { error: "ファイルの保存に失敗しました。時間をおいて再度お試しください。" });
  }

  // Attachment names are searchable.
  await reindexPage(prisma, page.id);
  return json(201, { url: `/api/files/${record.id}` });
}
