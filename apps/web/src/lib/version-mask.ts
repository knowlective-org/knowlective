import * as Y from "yjs";
import { TITLE_FIELD } from "@/lib/page-title";

// Masking text in saved page versions (e.g. a password typed by mistake).
//
// The version's document is rebuilt into a fresh Y.Doc with every match
// replaced by MASK, rather than edited in place: an edited Yjs document can
// still carry the deleted characters in its encoded state, a rebuilt one
// can't. Text is matched across formatting (a string half in bold still
// matches); element attributes (block props such as a table title, link
// URLs in marks) are masked too. The strings are never stored or logged.

export const MASK = "●●●●";
export const MAX_MASK_STRINGS = 10;
export const MAX_MASK_LENGTH = 500;
// Shorter strings would match far too much by accident.
export const MIN_MASK_LENGTH = 2;

type Delta = { insert: unknown; attributes?: Record<string, unknown> }[];

// Strings to mask, longest first so a longer match wins over a part of it.
export function normalizeMaskStrings(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const strings = [...new Set(raw.filter((s): s is string => typeof s === "string" && s.length > 0))];
  if (strings.length === 0 || strings.length > MAX_MASK_STRINGS) return null;
  if (strings.some((s) => s.length < MIN_MASK_LENGTH || s.length > MAX_MASK_LENGTH)) return null;
  return strings.sort((a, b) => b.length - a.length);
}

class Masker {
  count = 0;
  private readonly needles: string[][];

  constructor(strings: string[]) {
    this.needles = strings.map((s) => Array.from(s));
  }

  // Plain string (titles, attribute values).
  text(value: string): string {
    return this.chars(Array.from(value).map((ch) => ({ ch })))
      .map((c) => c.ch)
      .join("");
  }

  // Any attribute value: strings inside objects and arrays too.
  value(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((v) => this.value(v));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.value(v)]));
    }
    return value;
  }

  // Rich text: characters keep their formatting; a match becomes one MASK
  // carrying the formatting of its first character.
  delta(delta: Delta): Delta {
    type Char = { ch: string; attributes?: Record<string, unknown>; embed?: unknown };
    const chars: Char[] = [];
    for (const op of delta) {
      const attributes = op.attributes ? (this.value(op.attributes) as Record<string, unknown>) : undefined;
      if (typeof op.insert === "string") {
        for (const ch of Array.from(op.insert)) chars.push({ ch, attributes });
      } else {
        // Embeds never match (U+FFFC can't be typed).
        chars.push({ ch: "￼", attributes, embed: op.insert });
      }
    }
    const out: Delta = [];
    for (const c of this.chars(chars)) {
      if (c.embed !== undefined) {
        out.push({ insert: c.embed, ...(c.attributes && { attributes: c.attributes }) });
        continue;
      }
      const last = out[out.length - 1];
      if (last && typeof last.insert === "string" && JSON.stringify(last.attributes) === JSON.stringify(c.attributes)) {
        last.insert += c.ch;
      } else {
        out.push({ insert: c.ch, ...(c.attributes && { attributes: c.attributes }) });
      }
    }
    return out;
  }

  private chars<T extends { ch: string }>(chars: T[]): T[] {
    const out: T[] = [];
    for (let i = 0; i < chars.length; ) {
      const needle = this.needles.find((n) => n.every((ch, j) => chars[i + j]?.ch === ch));
      if (needle) {
        out.push({ ...chars[i], ch: MASK });
        this.count++;
        i += needle.length;
      } else {
        out.push(chars[i]);
        i++;
      }
    }
    return out;
  }
}

function copyNode(node: Y.XmlElement | Y.XmlText, masker: Masker): Y.XmlElement | Y.XmlText {
  if (node instanceof Y.XmlText) {
    const text = new Y.XmlText();
    text.applyDelta(masker.delta(node.toDelta() as Delta));
    return text;
  }
  const element = new Y.XmlElement(node.nodeName);
  for (const [key, value] of Object.entries(node.getAttributes())) {
    element.setAttribute(key, masker.value(value) as string);
  }
  element.insert(0, node.toArray().map((child) => copyNode(child as Y.XmlElement | Y.XmlText, masker)));
  return element;
}

// Rebuilds a version's state with the strings masked. `count` is the number
// of matches; when it's 0 the state is returned unchanged.
export function maskVersionState(update: Uint8Array, strings: string[]): { state: Uint8Array; count: number } {
  const source = new Y.Doc();
  Y.applyUpdate(source, update);
  const masker = new Masker(strings);
  const target = new Y.Doc();
  target.transact(() => {
    const fragment = target.getXmlFragment("blocknote");
    fragment.insert(
      0,
      source
        .getXmlFragment("blocknote")
        .toArray()
        .map((node) => copyNode(node as Y.XmlElement | Y.XmlText, masker)),
    );
    target.getText(TITLE_FIELD).insert(0, masker.text(source.getText(TITLE_FIELD).toString()));
  });
  return masker.count === 0 ? { state: update, count: 0 } : { state: Y.encodeStateAsUpdate(target), count: masker.count };
}

// Masks a plain string (a version's title, the page title in a log line).
export function maskText(value: string, strings: string[]): { text: string; count: number } {
  const masker = new Masker(strings);
  const text = masker.text(value);
  return { text, count: masker.count };
}
