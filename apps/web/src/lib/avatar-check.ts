// The check for an uploaded avatar (lib/avatar.ts), and a person's initial
// for when there's none. No dependencies (unit-tested).

import { isAvatarColor } from "./avatar-mosaic";

// The browser makes it a small square (components/avatar-picker.tsx); the
// limit is for what comes to the server, whatever made it.
export const MAX_AVATAR_BYTES = 300 * 1024;
// The side of the square the browser makes, in pixels.
export const AVATAR_SIZE = 256;

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

export type AvatarError = "tooLarge" | "badType";

const startsWith = (bytes: Uint8Array, sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);

// The type of an uploaded picture, from its bytes (not its name or the
// browser's word): a PNG, JPEG or WebP. Nothing else (an SVG could carry
// script).
export function checkAvatar(bytes: Uint8Array): { type: AvatarType } | { error: AvatarError } {
  if (bytes.length > MAX_AVATAR_BYTES) return { error: "tooLarge" };
  if (bytes.length < 12) return { error: "badType" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: "image/jpeg" };
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { type: "image/webp" };
  return { error: "badType" };
}

export const isAvatarType = (type: string | null | undefined): type is AvatarType =>
  (AVATAR_TYPES as readonly string[]).includes(type ?? "");

// The first character of a name (a whole character: an emoji, or a letter
// with its marks), upper-cased; "?" for none.
export function initialOf(name: string | null | undefined): string {
  const text = (name ?? "").trim();
  if (!text) return "?";
  const first = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next().value?.segment ?? text;
  return first.toLocaleUpperCase();
}

// How a person's avatar looks: their picture's address, or without one, the
// mosaic's color (null: their cursor's) and pattern (lib/avatar-mosaic.ts).
export type AvatarLook = { url: string | null; color: string | null; seed: number };

export const avatarLook = (user: {
  id: string;
  avatarUpdatedAt?: Date | null;
  avatarColor?: string | null;
  avatarSeed?: number | null;
}): AvatarLook => ({
  url: avatarUrl(user.id, user.avatarUpdatedAt),
  color: isAvatarColor(user.avatarColor) ? user.avatarColor : null,
  seed: user.avatarSeed ?? 0,
});

// The picture's address; the time it was set makes a new one for a new picture.
export const avatarUrl = (userId: string, updatedAt: Date | number | null | undefined): string | null =>
  updatedAt == null ? null : `/api/users/${userId}/avatar?v=${typeof updatedAt === "number" ? updatedAt : updatedAt.getTime()}`;
