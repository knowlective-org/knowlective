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

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  TEXT: "テキスト",
  DATE: "日付",
  USER: "ユーザー",
  SELECT: "選択肢",
};

export const OPTION_COLORS = ["#e3e2e0", "#fadec9", "#fdecc8", "#dbeddb", "#d3e5ef", "#e8deee", "#f5e0e9", "#ffe2dd"];

// Columns every child-page table offers besides the custom ones.
export const BUILTIN_COLUMNS = {
  createdAt: "作成日時",
  createdBy: "作成者",
  updatedAt: "更新日時",
  updatedBy: "更新者",
} as const;
export type BuiltinColumn = keyof typeof BUILTIN_COLUMNS;

export type UserRef = { id: string; name: string };

export type ChildPageItem = { id: string; parentId: string; title: string; icon: string | null };

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
