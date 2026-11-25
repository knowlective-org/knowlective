import { childTableFor } from "@/lib/child-table";
import { getPublicUrl } from "@/lib/site-url";
import type { PropertyColumn } from "@/lib/page-property-types";

// A page's child pages with their property values (the columns of its child
// page table, lib/page-properties.ts), for the public API and MCP: what the
// caller sees in the table, values by column name. A SELECT value is its
// option's name, a USER value the person (id and name), a DATE "YYYY-MM-DD";
// a MASKED value is sealed with a passphrase in the browser and never
// readable here, so only whether there is one is told. Each child also has
// who created and last changed it (id and name), as the table's "created
// by" / "updated by" columns show them.

type Person = { id: string; name: string | null };
type Value = string | Person | { masked: true } | null;

export type ChildProperties = {
  columns: { name: string; type: PropertyColumn["type"]; options?: string[] }[];
  children: {
    id: string;
    title: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    createdBy: Person;
    updatedBy: Person;
    properties: Record<string, Value>;
  }[];
};

// `names`: only these columns (by name); unknown names are an error. Null
// when the caller can't open the page.
export async function childProperties(
  userId: string,
  pageId: string,
  names?: string[],
): Promise<ChildProperties | { unknown: string[] } | null> {
  const table = await childTableFor(userId, pageId);
  if (!table) return null;
  // Columns sharing a name are told apart as "name", "name (2)", …
  const keyed = new Map<string, PropertyColumn>();
  for (const column of table.columns) {
    let key = column.name;
    for (let n = 2; keyed.has(key); n++) key = `${column.name} (${n})`;
    keyed.set(key, column);
  }
  if (names) {
    const unknown = names.filter((n) => !keyed.has(n));
    if (unknown.length > 0) return { unknown };
  }
  const wanted = [...keyed].filter(([key]) => !names || names.includes(key));
  const origin = await getPublicUrl();
  const person = (id: string): Person => ({ id, name: table.userNames[id] ?? null });
  const children = table.rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: `${origin}/pages/${row.id}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: person(row.createdById),
    updatedBy: person(row.updatedById ?? row.createdById),
    properties: Object.fromEntries(wanted.map(([key, column]) => [key, valueOf(column, row.values[column.id], table.userNames)])),
  }));
  return {
    columns: wanted.map(([key, c]) => ({ name: key, type: c.type, ...(c.type === "SELECT" ? { options: c.options.map((o) => o.name) } : {}) })),
    children,
  };
}

function valueOf(column: PropertyColumn, raw: string | undefined, userNames: Record<string, string>): Value {
  if (raw === undefined || raw === "") return null;
  switch (column.type) {
    case "SELECT":
      return column.options.find((o) => o.id === raw)?.name ?? null;
    case "USER":
      return { id: raw, name: userNames[raw] ?? null };
    case "MASKED":
      return { masked: true };
    default:
      return raw;
  }
}
