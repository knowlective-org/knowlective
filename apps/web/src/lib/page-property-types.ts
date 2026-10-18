// Shapes shared by the child-page Server Actions and the editor blocks
// (browser) — keep dependency-free.

export type PropertyType = "TEXT" | "DATE" | "USER" | "SELECT";

export type SelectOption = { id: string; name: string; color: string };

export type PropertyColumn = {
  id: string;
  type: PropertyType;
  name: string;
  options: SelectOption[];
};

// Every type, in the order offered (named by editor.childTable.types).
export const PROPERTY_TYPES: PropertyType[] = ["TEXT", "DATE", "USER", "SELECT"];

export const OPTION_COLORS = ["#e3e2e0", "#fadec9", "#fdecc8", "#dbeddb", "#d3e5ef", "#e8deee", "#f5e0e9", "#ffe2dd"];

// Columns every child-page table offers besides the custom ones (named by
// editor.childTable.builtin).
export const BUILTIN_COLUMNS = ["createdAt", "createdBy", "updatedAt", "updatedBy"] as const;
export type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number];

export type UserRef = { id: string; name: string };

export type ChildPageItem = {
  id: string;
  parentId: string;
  title: string;
  icon: string | null;
  // ISO time of the last stored edit (body, title or a property value).
  updatedAt: string;
};

export type ChildTableRow = {
  id: string;
  title: string;
  icon: string | null;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  updatedById: string | null;
  values: Record<string, string>;
};

export type ChildTableData = {
  canEditColumns: boolean;
  columns: PropertyColumn[];
  rows: ChildTableRow[];
  // Selectable for USER cells: enabled users who can open this page.
  assignees: UserRef[];
  // Display names for every user id appearing in the table.
  userNames: Record<string, string>;
};
