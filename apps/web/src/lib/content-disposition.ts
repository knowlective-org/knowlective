// The Content-Disposition header for serving an attachment under its name:
// an ASCII fallback plus the RFC 5987 UTF-8 name. No dependencies (unit-tested).
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
