// The check for an uploaded logo (SVG). No dependencies (unit-tested).

export const MAX_LOGO_BYTES = 200 * 1024;

export type LogoError = "tooLarge" | "notSvg" | "unsafe";

// An uploaded logo as it will be stored, or why not. Refused: anything that
// runs (scripts, event attributes, javascript: URLs, embedded HTML) or
// reaches out (links, external images and styles), and DOCTYPE / entities.
// Only drawing is allowed: shapes, paths, gradients, text, inline styles.
export function checkLogoSvg(raw: string): { svg: string } | { error: LogoError } {
  if (Buffer.byteLength(raw, "utf8") > MAX_LOGO_BYTES) return { error: "tooLarge" };
  const svg = raw.replace(/^﻿/, "").trim();
  const start = svg.replace(/^<\?xml[^>]*\?>\s*/i, "").replace(/^(<!--[\s\S]*?-->\s*)*/, "");
  if (!/^<svg[\s>]/i.test(start) || !/<\/svg>\s*$/i.test(svg)) return { error: "notSvg" };
  const unsafe = [
    /<!DOCTYPE/i,
    /<!ENTITY/i,
    // With or without a namespace prefix (<svg:script>).
    /<\s*(?:[\w.-]+:)?(script|foreignObject|iframe|embed|object|audio|video|image|feImage|use|a|animate\w*|set|link|meta|handler|listener|style\s[^>]*src)\b/i,
    // Event attributes, however they're separated from what's before them.
    /[\s/"':]on\w+\s*=/i,
    /javascript:/i,
    /(xlink:)?href\s*=/i,
    /url\(\s*['"]?\s*(?!#)/i,
    /@import/i,
  ];
  if (unsafe.some((re) => re.test(svg))) return { error: "unsafe" };
  return { svg };
}
