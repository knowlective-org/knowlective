// A person's avatar without a picture: a mosaic of triangles in shades of
// one color (the one they chose, else their cursor's), with their initial
// on it (drawn by components/avatar.tsx). The pattern comes from their id
// and a number they can count up ("Another pattern"), so it stays the same
// wherever it's shown and changes only when they ask.
// No dependencies (unit tests: test/avatar-mosaic.test.ts).

// A chosen color, as stored (User.avatarColor).
export const AVATAR_COLOR = /^#[0-9a-f]{6}$/;
export const isAvatarColor = (v: unknown): v is string => typeof v === "string" && AVATAR_COLOR.test(v);

// Suggestions on the account screen (any color can be chosen).
export const AVATAR_COLOR_PRESETS = ["#2f7d6d", "#1f5f8b", "#6b4fa3", "#b0457a", "#c0562b", "#8a6d1f", "#4d5560"] as const;

// The grid: N × N squares, each cut corner to corner into two triangles.
const N = 4;

// A small seeded generator (FNV-1a, then xorshift): the same seed gives the
// same numbers, from 0 up to 1.
function generator(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  if (h === 0) h = 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (k: number) => {
    const c = l - a * Math.max(-1, Math.min((k + h / 30) % 12 - 3, 9 - ((k + h / 30) % 12), 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Four shades of the color's hue, light to dark: the mosaic's only colors.
// Its saturation is kept moderate, so any choice makes a calm pattern (a
// gray stays gray).
export function mosaicShades(color: string): string[] {
  const [h, s] = hsl(isAvatarColor(color) ? color : "#4d5560");
  const sat = s < 0.05 ? 0 : Math.max(0.25, Math.min(0.7, s));
  return [0.92, 0.76, 0.56, 0.36].map((l) => hex(h, sat, l));
}

// The outline of the initial on the mosaic: a deep shade of the same hue,
// darker than any of the mosaic's.
export function mosaicOutline(color: string): string {
  const [h, s] = hsl(isAvatarColor(color) ? color : "#4d5560");
  const sat = s < 0.05 ? 0 : Math.max(0.25, Math.min(0.7, s));
  return hex(h, sat, 0.18);
}

// The text on a badge in a person's color (their cursor's name): a very
// light shade of its hue on a dark color, a very deep one on a light color
// (whichever reads better); plain white or black where a shade wouldn't
// reach a contrast of 4.5:1 (some middle colors).
export function badgeInk(color: string): string {
  const base = isAvatarColor(color) ? color : "#4d5560";
  const [h, s] = hsl(base);
  const sat = s < 0.05 ? 0 : Math.max(0.25, Math.min(0.7, s));
  const contrast = (ink: string) => {
    const [x, y] = [luminance(ink), luminance(base)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const [light, deep] = [hex(h, sat, 0.97), hex(h, sat, 0.1)];
  const shade = contrast(light) >= contrast(deep) ? light : deep;
  if (contrast(shade) >= 4.5) return shade;
  return contrast("#ffffff") >= contrast("#000000") ? "#ffffff" : "#000000";
}

// WCAG relative luminance.
export function luminance(color: string): number {
  const n = parseInt(color.slice(1), 16);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin((n >> 16) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
}

// What the collab server puts on each person's cursor (awareness `user`):
// their name, their color (the avatar's, else their cursor's), and what
// draws their avatar. Read back checked, as anything in awareness.
export type CursorUser = { name: string; color: string; id: string; seed: number; image: string | null };
const AVATAR_PATH = /^\/api\/users\/[A-Za-z0-9_-]{1,64}\/avatar\?v=\d{1,16}$/;
export function readCursorUser(raw: unknown): CursorUser | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.name !== "string" || !isAvatarColor(u.color) || typeof u.id !== "string") return null;
  return {
    name: u.name,
    color: u.color,
    id: u.id,
    seed: typeof u.seed === "number" && Number.isSafeInteger(u.seed) ? u.seed : 0,
    image: typeof u.image === "string" && AVATAR_PATH.test(u.image) ? u.image : null,
  };
}

// The mosaic as an SVG (a square N × N, scaled to fit), for a CSS background.
export function mosaicSvg(userId: string, seed: number, color: string): string {
  const shades = mosaicShades(color);
  const next = generator(`${userId}:${seed}`);
  const pick = () => shades[Math.floor(next() * shades.length)];
  const shapes: string[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Cut one way or the other.
      const halves =
        next() < 0.5
          ? [`${x},${y} ${x + 1},${y} ${x},${y + 1}`, `${x + 1},${y} ${x + 1},${y + 1} ${x},${y + 1}`]
          : [`${x},${y} ${x + 1},${y} ${x + 1},${y + 1}`, `${x},${y} ${x + 1},${y + 1} ${x},${y + 1}`];
      // A stroke in its own color closes the hairline seams between triangles.
      for (const points of halves) {
        const fill = pick();
        shapes.push(`<polygon points="${points}" fill="${fill}" stroke="${fill}" stroke-width="0.03"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" preserveAspectRatio="none">${shapes.join("")}</svg>`;
}

// The same, as a CSS background image. Kept for the people shown on the
// page (many avatars of few people).
const cache = new Map<string, string>();
export function mosaicBackground(userId: string, seed: number, color: string): string {
  const key = `${userId} ${seed} ${color}`;
  let value = cache.get(key);
  if (!value) {
    value = `url("data:image/svg+xml,${encodeURIComponent(mosaicSvg(userId, seed, color))}")`;
    if (cache.size >= 500) cache.clear();
    cache.set(key, value);
  }
  return value;
}
