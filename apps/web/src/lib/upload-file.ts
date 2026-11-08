import { withBasePath } from "./base-path";

// Stores a file as an attachment of the page (POST /api/files, which checks
// access and the allowed file types) and returns its URL, "/api/files/<id>"
// without the base path. Throws UploadError with the server's message, or
// `failed` when there's none.
export class UploadError extends Error {}

export async function postFile(pageId: string, file: File, failed: string): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(withBasePath(`/api/files?pageId=${encodeURIComponent(pageId)}`), { method: "POST", body });
  const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !data?.url) throw new UploadError(data?.error ?? failed);
  return data.url;
}
