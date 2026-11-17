// The check for an uploaded knowledge-root favicon. No dependencies besides
// the logo's SVG check (unit-tested).
import { checkLogoSvg } from "./logo-svg";

export const MAX_FAVICON_BYTES = 200 * 1024;

export const FAVICON_TYPES = ["image/png", "image/x-icon", "image/svg+xml"] as const;
export type FaviconType = (typeof FAVICON_TYPES)[number];

export type FaviconError = "tooLarge" | "badType" | "unsafe";

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);

// An uploaded favicon as it will be stored, or why not. The type comes from
// the bytes, not the name or the browser's word: a PNG (its signature), an
// ICO (its header: reserved 0, type 1, at least one image), or an SVG that
// passes the logo's check (nothing that runs or reaches out).
export function checkFavicon(bytes: Uint8Array): { type: FaviconType; bytes: Uint8Array } | { error: FaviconError } {
  if (bytes.length === 0) return { error: "badType" };
  if (bytes.length > MAX_FAVICON_BYTES) return { error: "tooLarge" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image/png", bytes };
  if (bytes.length >= 6 && startsWith(bytes, [0, 0, 1, 0]) && (bytes[4] | (bytes[5] << 8)) > 0) return { type: "image/x-icon", bytes };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const svg = checkLogoSvg(text);
  if ("svg" in svg) return { type: "image/svg+xml", bytes: new TextEncoder().encode(svg.svg) };
  return { error: svg.error === "unsafe" ? "unsafe" : "badType" };
}

export const isFaviconType = (type: string | null | undefined): type is FaviconType =>
  (FAVICON_TYPES as readonly string[]).includes(type ?? "");
