"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  addColumn,
  deleteColumn,
  loadChildTable,
  moveColumn,
  renameColumn,
  setCellValue,
  setColumnOptions,
} from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { displayTitle } from "@/lib/page-title";
import {
  BUILTIN_COLUMNS,
  OPTION_COLORS,
  PROPERTY_TYPE_LABELS,
  type BuiltinColumn,
  type ChildTableData,
  type ChildTableRow,
  type PropertyColumn,
  type PropertyType,
  type SelectOption,
} from "@/lib/page-property-types";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-blocks.module.css";

// 子ページテーブル: one row per child page. Columns (and their values) live
// in the database, shared by every table on the same page; this block only
// stores how it's shown: hidden columns and the sort order.

const DEFAULT_HIDDEN: BuiltinColumn[] = ["createdAt", "createdBy"];
const BUILTIN_KEYS = Object.keys(BUILTIN_COLUMNS) as BuiltinColumn[];

type Sort = { key: string; dir: "asc" | "desc" } | null;

export const childTableBlock = createReactBlockSpec(
  {
    type: "childTable",
    propSchema: {
      // JSON array of column keys (built-in names or column ids).
      hidden: { default: JSON.stringify(DEFAULT_HIDDEN) },
      // "<key>:asc" / "<key>:desc", or "" for creation order.
      sort: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <ChildTable
        hidden={parseHidden(block.props.hidden)}
        sort={parseSort(block.props.sort)}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
  },
);

function parseHidden(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseSort(raw: string): Sort {
  const [key, dir] = raw.split(":");
  return key && (dir === "asc" || dir === "desc") ? { key, dir } : null;
}

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" });

async function run(action: Promise<{ error?: string }>) {
  const result = await action.catch(() => ({ error: "保存に失敗しました。" }));
  if (result.error) window.alert(result.error);
  return !result.error;
}

function ChildTable({
  hidden,
  sort: savedSort,
  editable,
  onChange,
}: {
  hidden: string[];
  sort: Sort;
  editable: boolean;
  onChange: (props: { hidden?: string; sort?: string }) => void;
}) {
  const { pageId } = usePageEditor();
  const { data, reload } = useChildrenData(loadChildTable);
  // Read-only viewers can still sort for themselves; it just isn't saved.
  const [localSort, setLocalSort] = useState<Sort | undefined>(undefined);
  const sort = editable ? savedSort : localSort === undefined ? savedSort : localSort;
  const setSort = (next: Sort) =>
    editable ? onChange({ sort: next ? `${next.key}:${next.dir}` : "" }) : setLocalSort(next);
  const [menu, setMenu] = useState<string | null>(null);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const columns = data?.columns ?? [];
  const shownColumns = columns.filter((c) => !hiddenSet.has(c.id));
  const shownBuiltins = BUILTIN_KEYS.filter((k) => !hiddenSet.has(k));

  const rows = useMemo(() => (data ? sortRows(data, sort) : []), [data, sort]);

  if (data === undefined) {
    return <Frame>読み込み中…</Frame>;
  }
  if (data === null) {
    return <Frame>このテーブルは表示できません。</Frame>;
  }

  const toggleHidden = (key: string) => {
    const next = new Set(hiddenSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({ hidden: JSON.stringify([...next]) });
  };
  const after = async (action: Promise<{ error?: string }>) => {
    if (await run(action)) void reload();
  };

  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildTableBlock">
      <div className={styles.header}>
        <span className={styles.label}>子ページテーブル</span>
        {editable && (
          <Popover
            open={menu === "columns"}
            onOpenChange={(o) => setMenu(o ? "columns" : null)}
            trigger="表示する列"
            dataUi="ChildTableBlock.columnsMenu"
          >
            {[...columns.map((c) => ({ key: c.id, label: c.name })), ...BUILTIN_KEYS.map((k) => ({ key: k, label: BUILTIN_COLUMNS[k] }))].map(
              ({ key, label }) => (
                <label key={key} className={styles.check}>
                  <input type="checkbox" checked={!hiddenSet.has(key)} onChange={() => toggleHidden(key)} />
                  {label}
                </label>
              ),
            )}
          </Popover>
        )}
        {editable && data.canEditColumns && (
          <Popover
            open={menu === "add"}
            onOpenChange={(o) => setMenu(o ? "add" : null)}
            trigger="＋ 列を追加"
            dataUi="ChildTableBlock.addColumn"
          >
            <AddColumnForm
              onSubmit={async (name, type) => {
                if (await run(addColumn(pageId, name, type))) {
                  setMenu(null);
                  void reload();
                }
              }}
            />
          </Popover>
        )}
      </div>

      {rows.length === 0 ? (
        <p className={styles.muted}>子ページはありません。</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <HeaderCell label="タイトル" sortKey="title" sort={sort} onSort={setSort} />
                {shownColumns.map((c, i) => (
                  <HeaderCell
                    key={c.id}
                    label={c.name}
                    sortKey={c.id}
                    sort={sort}
                    onSort={setSort}
                    menuOpen={menu === `col:${c.id}`}
                    onMenuOpenChange={editable && data.canEditColumns ? (o) => setMenu(o ? `col:${c.id}` : null) : undefined}
                  >
                    <ColumnMenu
                      column={c}
                      first={i === 0}
                      last={i === shownColumns.length - 1}
                      onRename={(name) => after(renameColumn(c.id, name))}
                      onOptions={(options) => after(setColumnOptions(c.id, options))}
                      onMove={(dir) => after(moveColumn(c.id, dir))}
                      onDelete={() => {
                        if (window.confirm(`列「${c.name}」と、その列のすべての値を削除しますか？`)) {
                          setMenu(null);
                          void after(deleteColumn(c.id));
                        }
                      }}
                    />
                  </HeaderCell>
                ))}
                {shownBuiltins.map((k) => (
                  <HeaderCell key={k} label={BUILTIN_COLUMNS[k]} sortKey={k} sort={sort} onSort={setSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-ui="ChildTableBlock.row" data-id={row.id}>
                  <td className={styles.titleCell}>
                    <Link href={`/pages/${row.id}`} className={styles.pageLink}>
                      <span aria-hidden>{row.icon ?? "📄"}</span>
                      <span>{displayTitle(row.title)}</span>
                    </Link>
                  </td>
                  {shownColumns.map((c) => (
                    <td key={c.id}>
                      <Cell
                        column={c}
                        value={row.values[c.id] ?? ""}
                        editable={editable && row.canEdit}
                        data={data}
                        onSave={(value) => after(setCellValue(row.id, c.id, value))}
                      />
                    </td>
                  ))}
                  {shownBuiltins.map((k) => (
                    <td key={k} className={styles.metaCell}>
                      {builtinText(row, k, data)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildTableBlock">
      <div className={styles.header}>
        <span className={styles.label}>子ページテーブル</span>
      </div>
      <p className={styles.muted}>{children}</p>
    </div>
  );
}

function builtinText(row: ChildTableRow, key: BuiltinColumn, data: ChildTableData): string {
  switch (key) {
    case "createdAt":
      return dateTimeFormat.format(new Date(row.createdAt));
    case "updatedAt":
      return dateTimeFormat.format(new Date(row.updatedAt));
    case "createdBy":
      return data.userNames[row.createdById] ?? "";
    case "updatedBy":
      return row.updatedById ? (data.userNames[row.updatedById] ?? "") : "";
  }
}

// Sort key of one cell; empty cells always go last.
function sortValue(row: ChildTableRow, key: string, data: ChildTableData): string | number | null {
  if (key === "title") return displayTitle(row.title);
  if (key === "createdAt" || key === "updatedAt") return Date.parse(row[key]);
  if (key === "createdBy" || key === "updatedBy") return builtinText(row, key, data) || null;
  const column = data.columns.find((c) => c.id === key);
  const value = row.values[key];
  if (!column || !value) return null;
  if (column.type === "USER") return data.userNames[value] ?? null;
  if (column.type === "SELECT") {
    const index = column.options.findIndex((o) => o.id === value);
    return index < 0 ? null : index;
  }
  return value;
}

function sortRows(data: ChildTableData, sort: Sort): ChildTableRow[] {
  if (!sort) return data.rows;
  const collator = new Intl.Collator("ja");
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...data.rows].sort((a, b) => {
    const x = sortValue(a, sort.key, data);
    const y = sortValue(b, sort.key, data);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return cmp * sign;
  });
}

function HeaderCell({
  label,
  sortKey,
  sort,
  onSort,
  menuOpen,
  onMenuOpenChange,
  children,
}: {
  label: string;
  sortKey: string;
  sort: Sort;
  onSort: (sort: Sort) => void;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const active = sort?.key === sortKey ? sort.dir : null;
  // Click cycles: ascending → descending → creation order.
  const next: Sort = active === null ? { key: sortKey, dir: "asc" } : active === "asc" ? { key: sortKey, dir: "desc" } : null;
  return (
    <th>
      <div className={styles.th}>
        <button type="button" className={styles.thButton} onClick={() => onSort(next)} title="並び替え">
          {label}
          {active && <span aria-hidden>{active === "asc" ? " ↑" : " ↓"}</span>}
        </button>
        {onMenuOpenChange && (
          <Popover open={!!menuOpen} onOpenChange={onMenuOpenChange} trigger="⋯" label="列の設定" dataUi="ChildTableBlock.columnMenu">
            {children}
          </Popover>
        )}
      </div>
    </th>
  );
}

// A button that opens a small panel below it; closes on outside click / Esc.
// The panel is position: fixed so the table's scroll container can't clip it.
function Popover({
  open,
  onOpenChange,
  trigger,
  label,
  dataUi,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  label?: string;
  dataUi: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      // Right-aligned under the button, unless that would run off the left edge.
      setPosition(
        rect.right < 280
          ? { top: rect.bottom + 4, left: rect.left }
          : { top: rect.bottom + 4, right: window.innerWidth - rect.right },
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, onOpenChange]);
  return (
    <span className={styles.popoverAnchor} ref={ref}>
      <button
        type="button"
        className={styles.toolButton}
        data-ui={dataUi}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div className={styles.popover} style={position}>
          {children}
        </div>
      )}
    </span>
  );
}

function AddColumnForm({ onSubmit }: { onSubmit: (name: string, type: PropertyType) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("TEXT");
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name, type);
      }}
    >
      <input
        className={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="列名（例: 担当者）"
        maxLength={50}
        autoFocus
        required
      />
      <select className={styles.input} value={type} onChange={(e) => setType(e.target.value as PropertyType)}>
        {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((t) => (
          <option key={t} value={t}>
            {PROPERTY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <button type="submit" className={styles.primaryButton}>
        追加
      </button>
    </form>
  );
}

function ColumnMenu({
  column,
  first,
  last,
  onRename,
  onOptions,
  onMove,
  onDelete,
}: {
  column: PropertyColumn;
  first: boolean;
  last: boolean;
  onRename: (name: string) => void;
  onOptions: (options: SelectOption[]) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(column.name);
  return (
    <div className={styles.form}>
      <div className={styles.muted}>種類: {PROPERTY_TYPE_LABELS[column.type]}</div>
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          onRename(name);
        }}
      >
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        <button type="submit" className={styles.toolButton}>
          名前を変更
        </button>
      </form>
      {column.type === "SELECT" && <OptionsEditor options={column.options} onSave={onOptions} />}
      <div className={styles.row}>
        <button type="button" className={styles.toolButton} disabled={first} onClick={() => onMove(-1)}>
          ← 左へ
        </button>
        <button type="button" className={styles.toolButton} disabled={last} onClick={() => onMove(1)}>
          右へ →
        </button>
        <button type="button" className={styles.dangerButton} onClick={onDelete}>
          列を削除
        </button>
      </div>
    </div>
  );
}

function newOptionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function OptionsEditor({ options, onSave }: { options: SelectOption[]; onSave: (options: SelectOption[]) => void }) {
  const [draft, setDraft] = useState(options);
  const update = (i: number, patch: Partial<SelectOption>) =>
    setDraft((d) => d.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className={styles.form}>
      <div className={styles.muted}>選択肢</div>
      {draft.map((o, i) => (
        <div key={o.id} className={styles.row}>
          <button
            type="button"
            className={styles.swatch}
            style={{ background: o.color }}
            title="色を変える"
            onClick={() => update(i, { color: OPTION_COLORS[(OPTION_COLORS.indexOf(o.color) + 1) % OPTION_COLORS.length] })}
          />
          <input className={styles.input} value={o.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={50} />
          <button
            type="button"
            className={styles.toolButton}
            aria-label="選択肢を削除"
            onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() =>
            setDraft((d) => [...d, { id: newOptionId(), name: "", color: OPTION_COLORS[d.length % OPTION_COLORS.length] }])
          }
        >
          ＋ 選択肢を追加
        </button>
        <button type="button" className={styles.primaryButton} onClick={() => onSave(draft.filter((o) => o.name.trim()))}>
          選択肢を保存
        </button>
      </div>
    </div>
  );
}

function Cell({
  column,
  value,
  editable,
  data,
  onSave,
}: {
  column: PropertyColumn;
  value: string;
  editable: boolean;
  data: ChildTableData;
  onSave: (value: string) => void;
}) {
  if (column.type === "SELECT") {
    const option = column.options.find((o) => o.id === value);
    if (!editable) return option ? <span className={styles.chip} style={{ background: option.color }}>{option.name}</span> : null;
    return (
      <select
        className={styles.cellSelect}
        style={option ? { background: option.color } : undefined}
        value={option ? value : ""}
        onChange={(e) => onSave(e.target.value)}
      >
        <option value="">—</option>
        {column.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  }

  if (column.type === "USER") {
    const name = value ? (data.userNames[value] ?? "（不明なユーザー）") : "";
    if (!editable) return <>{name}</>;
    const known = !value || data.assignees.some((u) => u.id === value);
    return (
      <select className={styles.cellSelect} value={value} onChange={(e) => onSave(e.target.value)}>
        <option value="">—</option>
        {!known && <option value={value}>{name}</option>}
        {data.assignees.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    );
  }

  if (column.type === "DATE") {
    if (!editable) return <>{value}</>;
    return <input type="date" className={styles.cellInput} value={value} onChange={(e) => onSave(e.target.value)} />;
  }

  if (!editable) return <span className={styles.text}>{value}</span>;
  return <TextCell value={value} onSave={onSave} />;
}

// Saves on blur / Enter; Esc restores. A remote change replaces the text
// unless this cell is being edited.
function TextCell({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const shown = editing ? draft : value;
  return (
    <input
      className={styles.cellInput}
      value={shown}
      maxLength={2000}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (!cancelled.current && draft.trim() !== value) onSave(draft);
        cancelled.current = false;
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
