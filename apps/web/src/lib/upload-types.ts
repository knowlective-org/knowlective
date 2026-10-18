// Which files may be attached, by file name extension (set in /admin/files,
// InstanceConfig.uploadAllowedExtensions). An empty list means no restriction.
// No dependencies: read by the upload route, the admin form and the editor.

export const MAX_ALLOWED_EXTENSIONS = 200;

// The list a new instance starts with, and what the admin form's "recommended"
// button restores: documents, office files, images, audio / video and zip.
// Deliberately absent: programs and scripts (exe, msi, bat, sh, js …), HTML
// and SVG (they can carry scripts), and macro-enabled office files (docm,
// xlsm, pptm). Same list as the column default in schema.prisma; keep the two
// the same (sorted, as parseExtensions returns them).
export const RECOMMENDED_EXTENSIONS: readonly string[] = [
  // Documents and data
  "csv", "json", "markdown", "md", "pdf", "rtf", "tsv", "txt",
  // Office
  "doc", "docx", "odp", "ods", "odt", "ppt", "pptx", "xls", "xlsx",
  // Images
  "avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "webp",
  // Audio and video
  "m4a", "mov", "mp3", "mp4", "ogg", "wav", "webm",
  // Archives
  "zip",
].sort();

const EXTENSION = /^[a-z0-9][a-z0-9_+-]{0,15}$/;

// Extensions typed into the admin form: separated by spaces, commas or line
// breaks, with or without the leading dot, in any case. Returns the invalid
// entries instead when there are any.
export function parseExtensions(text: string): { extensions: string[] } | { invalid: string[] } {
  const entries = text
    .split(/[\s,、，]+/)
    .map((entry) => entry.trim().replace(/^\*?\./, "").toLowerCase())
    .filter(Boolean);
  const invalid = entries.filter((entry) => !EXTENSION.test(entry));
  if (invalid.length > 0) return { invalid: [...new Set(invalid)] };
  return { extensions: [...new Set(entries)].sort() };
}

// The part after the last dot, lowercased; "" when there is none.
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? "" : name.slice(dot + 1).toLowerCase();
}

// A file without an extension is refused whenever the list isn't empty.
export function isUploadAllowed(name: string, allowed: readonly string[]): boolean {
  return allowed.length === 0 || allowed.includes(fileExtension(name));
}

// Why a file was refused, as the files.errors message to show.
export function uploadRefusedMessage(
  name: string,
  t: (key: "typeNotAllowed" | "noExtension", values: { extension: string }) => string,
): string {
  const extension = fileExtension(name);
  return t(extension ? "typeNotAllowed" : "noExtension", { extension });
}
