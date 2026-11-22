// Styles on parts of a whiteboard text (bold, italic, underline, strike,
// a text color, a highlight). The text itself stays a plain string (searched, copied,
// shown as lists by its line starts: components/whiteboard/rich-text.ts);
// its styles are kept beside it as ranges of it (`<field>Marks`, e.g.
// `textMarks`: [{ from, to, bold: true }, …], `from` and `to` in UTF-16
// units of the text). Both are written together, last writer wins, as the
// text already is.
// No dependencies (unit tests: test/whiteboard-marks.test.ts).

// Text colors, besides the default (the board's ink). Dark ones only: each
// has a contrast of at least 4.5:1 on every item color (the whiteboard's
// colors are all light), checked by the unit test against globals.css.
export const TEXT_COLORS = ["red", "brown", "green", "blue", "purple", "pink", "gray"] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

// Highlights (a background behind the text, as a marker pen), stronger than
// the item colors so they show on them, but light enough that the ink and
// every text color keep a contrast of at least 4.5:1 on them (the unit test
// checks globals.css).
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const STYLE_FLAGS = ["bold", "italic", "underline", "strike"] as const;
export type StyleFlag = (typeof STYLE_FLAGS)[number];

export type TextStyle = { bold?: true; italic?: true; underline?: true; strike?: true; color?: TextColor; highlight?: HighlightColor };
export type TextMark = TextStyle & { from: number; to: number };
// A change of style: a flag on (true) or off (false), a color or a highlight,
// or back to none (null). What's left out stays as it is.
export type StylePatch = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: TextColor | null;
  highlight?: HighlightColor | null;
};
// What a style button asks for: a flag turned over, or a color or highlight set.
export type StyleChange = { flag: StyleFlag } | { color: TextColor | null } | { highlight: HighlightColor | null };

export const MAX_MARKS = 1000;

// The field beside a text field that holds its styles.
export const marksField = <F extends string>(field: F) => `${field}Marks` as `${F}Marks`;

const isColor = (v: unknown): v is TextColor => (TEXT_COLORS as readonly unknown[]).includes(v);
const isHighlight = (v: unknown): v is HighlightColor => (HIGHLIGHT_COLORS as readonly unknown[]).includes(v);

function cleanStyle(raw: Record<string, unknown>): TextStyle | null {
  const style: TextStyle = {};
  for (const flag of STYLE_FLAGS) if (raw[flag] === true) style[flag] = true;
  if (isColor(raw.color)) style.color = raw.color;
  if (isHighlight(raw.highlight)) style.highlight = raw.highlight;
  return Object.keys(style).length > 0 ? style : null;
}

const sameStyle = (a: TextStyle | null | undefined, b: TextStyle | null | undefined) =>
  (a?.bold ?? false) === (b?.bold ?? false) &&
  (a?.italic ?? false) === (b?.italic ?? false) &&
  (a?.underline ?? false) === (b?.underline ?? false) &&
  (a?.strike ?? false) === (b?.strike ?? false) &&
  (a?.color ?? null) === (b?.color ?? null) &&
  (a?.highlight ?? null) === (b?.highlight ?? null);

// Each character's style (null: none).
function expand(marks: TextMark[], length: number): (TextStyle | null)[] {
  const styles: (TextStyle | null)[] = new Array(length).fill(null);
  for (const m of marks) {
    const { from, to, ...style } = m;
    for (let i = Math.max(0, from); i < Math.min(length, to); i++) styles[i] = style;
  }
  return styles;
}

// Back to ranges: neighbors with the same style joined, unstyled ones left out.
function compress(styles: (TextStyle | null)[]): TextMark[] {
  const marks: TextMark[] = [];
  let start = 0;
  for (let i = 1; i <= styles.length; i++) {
    if (i < styles.length && sameStyle(styles[i], styles[start])) continue;
    const style = styles[start];
    if (style && Object.keys(style).length > 0) marks.push({ from: start, to: i, ...style });
    start = i;
  }
  return marks;
}

// The styles as stored, checked: they come from the shared document (or a
// clipboard), so anything may be there. Ranges are kept within the text,
// in order; where they overlap, the later one wins.
export function readMarks(raw: unknown, length: number): TextMark[] {
  if (!Array.isArray(raw) || length === 0) return [];
  const styles: (TextStyle | null)[] = new Array(length).fill(null);
  for (const m of raw.slice(0, MAX_MARKS)) {
    if (!m || typeof m !== "object") continue;
    const { from, to } = m as Record<string, unknown>;
    if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    const style = cleanStyle(m as Record<string, unknown>);
    if (!style) continue;
    for (let i = Math.max(0, Math.floor(from)); i < Math.min(length, Math.ceil(to)); i++) styles[i] = style;
  }
  return compress(styles);
}

// The text from `from` to `to` in pieces of one style each.
export function styledRuns(text: string, marks: TextMark[], from = 0, to = text.length): { text: string; style: TextStyle | null }[] {
  const styles = expand(marks, text.length);
  const runs: { text: string; style: TextStyle | null }[] = [];
  let start = from;
  for (let i = from + 1; i <= to; i++) {
    if (i < to && sameStyle(styles[i], styles[start])) continue;
    if (i > start) runs.push({ text: text.slice(start, i), style: styles[start] });
    start = i;
  }
  return runs;
}

// What the whole range has in common (for the buttons' pressed state). An
// empty range: the style of the character before it (what typing there gets).
export function styleOf(marks: TextMark[], length: number, from: number, to: number): TextStyle {
  const styles = expand(marks, length);
  if (from >= to) return (from > 0 ? styles[from - 1] : styles[0]) ?? {};
  const common: TextStyle = {};
  for (const flag of STYLE_FLAGS) if (styles.slice(from, to).every((s) => s?.[flag])) common[flag] = true;
  const color = styles[from]?.color;
  if (color && styles.slice(from, to).every((s) => s?.color === color)) common.color = color;
  const highlight = styles[from]?.highlight;
  if (highlight && styles.slice(from, to).every((s) => s?.highlight === highlight)) common.highlight = highlight;
  return common;
}

function patched(style: TextStyle | null, patch: StylePatch): TextStyle | null {
  const next: TextStyle = { ...style };
  for (const flag of STYLE_FLAGS) {
    if (patch[flag] === true) next[flag] = true;
    else if (patch[flag] === false) delete next[flag];
  }
  if (patch.color === null) delete next.color;
  else if (patch.color !== undefined) next.color = patch.color;
  if (patch.highlight === null) delete next.highlight;
  else if (patch.highlight !== undefined) next.highlight = patch.highlight;
  return Object.keys(next).length > 0 ? next : null;
}

// The styles with `patch` made on the range.
export function applyStyle(marks: TextMark[], length: number, from: number, to: number, patch: StylePatch): TextMark[] {
  const styles = expand(marks, length);
  for (let i = Math.max(0, from); i < Math.min(length, to); i++) styles[i] = patched(styles[i], patch);
  return compress(styles);
}

// A flag on for the range, or off when all of it has it already.
export function toggleFlag(marks: TextMark[], length: number, from: number, to: number, flag: StyleFlag): TextMark[] {
  const on = !styleOf(marks, length, from, to)[flag];
  return applyStyle(marks, length, from, to, { [flag]: on });
}

// Where `after` differs from `before`: the part replaced, as the same
// prefix and suffix are taken away.
export function changedRange(before: string, after: string): { from: number; removed: number; inserted: number } {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { from: p, removed: before.length - p - s, inserted: after.length - p - s };
}

// The styles carried over to a changed text: the characters that are still
// there keep theirs; inserted ones take the style of the one before them
// (as typing does), or none (`plainInserts`). Line by line when the lines
// are the same in number (a list made of every line), else as one change.
export function remapMarks(before: string, after: string, marks: TextMark[], plainInserts = false): TextMark[] {
  if (marks.length === 0 || before === after) return before === after ? marks : [];
  const old = expand(marks, before.length);
  const next: (TextStyle | null)[] = [];
  const carry = (b: string, a: string, offset: number) => {
    const { from, removed, inserted } = changedRange(b, a);
    for (let i = 0; i < from; i++) next.push(old[offset + i]);
    const inherit = plainInserts ? null : (from > 0 ? old[offset + from - 1] : null);
    for (let i = 0; i < inserted; i++) next.push(inherit);
    for (let i = from + removed; i < b.length; i++) next.push(old[offset + i]);
  };
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  if (beforeLines.length === afterLines.length && beforeLines.length > 1) {
    let offset = 0;
    beforeLines.forEach((line, i) => {
      if (i > 0) next.push(old[offset - 1]);
      carry(line, afterLines[i], offset);
      offset += line.length + 1;
    });
  } else {
    carry(before, after, 0);
  }
  return compress(next);
}

// Ranges from each character's style (an editor reading what it shows).
export const marksFromStyles = (styles: (TextStyle | null)[]): TextMark[] => compress(styles);

// A style as CSS properties (React's names; the export turns them into
// declarations). `color` and `highlight` give the CSS values of a text color
// and a highlight.
export function textStyleCss(
  style: TextStyle,
  color: (c: TextColor) => string,
  highlight: (c: HighlightColor) => string,
): Record<string, string> {
  const css: Record<string, string> = {};
  if (style.bold) css.fontWeight = "700";
  if (style.italic) css.fontStyle = "italic";
  const lines = [style.underline && "underline", style.strike && "line-through"].filter(Boolean);
  if (lines.length > 0) css.textDecorationLine = lines.join(" ");
  if (style.color) css.color = color(style.color);
  if (style.highlight) css.backgroundColor = highlight(style.highlight);
  return css;
}

// A style in a short form for an attribute ("b i u s c:red h:yellow"), and back.
export function encodeStyle(style: TextStyle): string {
  const parts: string[] = STYLE_FLAGS.filter((f) => style[f]).map((f) => f[0]);
  if (style.color) parts.push(`c:${style.color}`);
  if (style.highlight) parts.push(`h:${style.highlight}`);
  return parts.join(" ");
}

export function decodeStyle(code: string): TextStyle | null {
  const style: TextStyle = {};
  for (const part of code.split(" ")) {
    const flag = STYLE_FLAGS.find((f) => f[0] === part);
    if (flag) style[flag] = true;
    else if (part.startsWith("c:") && isColor(part.slice(2))) style.color = part.slice(2) as TextColor;
    else if (part.startsWith("h:") && isHighlight(part.slice(2))) style.highlight = part.slice(2) as HighlightColor;
  }
  return Object.keys(style).length > 0 ? style : null;
}
