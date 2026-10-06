import { decrypt, encrypt, type PropertyType } from "shared";
import type { PropertyColumn, SelectOption } from "@/lib/page-property-types";

// Columns of the child-page table and their values. Everything a user typed
// (column names, SELECT options, values) is encrypted with the data key;
// the AAD binds each ciphertext to its row so it can't be moved elsewhere.

export const MAX_COLUMNS = 30;
export const MAX_COLUMN_NAME_LENGTH = 50;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_SELECT_OPTIONS = 50;

const nameAad = (defId: string) => `yosuga:prop-name:${defId}`;
const optionsAad = (defId: string) => `yosuga:prop-options:${defId}`;
const valueAad = (pageId: string, defId: string) => `yosuga:prop-value:${pageId}:${defId}`;

type Key = Uint8Array;

const seal = (key: Key, text: string, aad: string) => Uint8Array.from(encrypt(key, Buffer.from(text, "utf8"), aad));
const open = (key: Key, bytes: Uint8Array, aad: string) => decrypt(key, bytes, aad).toString("utf8");

export function sealColumnName(key: Key, defId: string, name: string) {
  return seal(key, name, nameAad(defId));
}

export function sealOptions(key: Key, defId: string, options: SelectOption[]) {
  return seal(key, JSON.stringify(options), optionsAad(defId));
}

export function sealValue(key: Key, pageId: string, defId: string, value: string) {
  return seal(key, value, valueAad(pageId, defId));
}

export function openColumn(
  key: Key,
  def: { id: string; type: PropertyType; name: Uint8Array; options: Uint8Array | null },
): PropertyColumn {
  return {
    id: def.id,
    type: def.type,
    name: open(key, def.name, nameAad(def.id)),
    options: def.options ? (JSON.parse(open(key, def.options, optionsAad(def.id))) as SelectOption[]) : [],
  };
}

export function openValue(key: Key, row: { pageId: string; defId: string; value: Uint8Array }) {
  return open(key, row.value, valueAad(row.pageId, row.defId));
}

export function normalizeColumnName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_COLUMN_NAME_LENGTH ? name : null;
}

// Checks a SELECT option list sent by the client and returns a clean copy.
export function normalizeOptions(raw: unknown): SelectOption[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SELECT_OPTIONS) return null;
  const seen = new Set<string>();
  const result: SelectOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") return null;
    const { id, name, color } = o as Record<string, unknown>;
    const label = normalizeColumnName(name);
    if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id) || seen.has(id) || !label) return null;
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    seen.add(id);
    result.push({ id, name: label, color });
  }
  return result;
}

// A cell value as stored (empty string = clear). `isUser` checks a USER id.
export function validateValue(
  column: PropertyColumn,
  value: string,
  isUser: (id: string) => boolean,
): boolean {
  if (value === "") return true;
  switch (column.type) {
    case "TEXT":
      return value.length <= MAX_TEXT_LENGTH;
    case "DATE":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
    case "USER":
      return isUser(value);
    case "SELECT":
      return column.options.some((o) => o.id === value);
  }
}
