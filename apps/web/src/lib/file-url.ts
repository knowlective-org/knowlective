// An attachment's URL in a page: "/api/files/<id>", stored without the base
// path (lib/base-path.ts). No dependencies: the editor and the server both use it.

const FILE_URL = /^\/api\/files\/([A-Za-z0-9_-]{1,64})$/;

export const fileUrl = (fileId: string) => `/api/files/${fileId}`;

// The file id of an attachment's URL, or null. `siteUrl` (the public URL:
// origin and base path) also takes the absolute form the Markdown export
// writes ("https://example.com/knowlective/api/files/<id>").
export function fileIdOf(url: unknown, siteUrl?: string): string | null {
  if (typeof url !== "string") return null;
  let path = url;
  if (siteUrl && url.startsWith(`${siteUrl}/`)) path = url.slice(siteUrl.length);
  return FILE_URL.exec(path)?.[1] ?? null;
}
