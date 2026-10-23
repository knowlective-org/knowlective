"use client";

import { PageLink } from "./page-link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  addColumn,
  deleteColumn,
  loadChildTable,
  renameColumn,
  setCellValue,
  setColumnOptions,
} from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { createChildPageInPlace } from "@/app/(app)/actions";
import { useDisplayTitle } from "@/i18n/use-display-title";
import {
  BUILTIN_COLUMNS,
  OPTION_COLORS,
  PROPERTY_TYPES,
  type BuiltinColumn,
  type ChildTableData,
  type ChildTableRow,
  type PropertyColumn,
  type PropertyType,
  type SelectOption,
} from "@/lib/page-property-types";
import { BlockTitle } from "./block-title";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-blocks.module.css";
import { showAlert, showConfirm } from "@/components/dialog";
import { BLOCK_CONFIGS } from "./block-configs";

// Child page table: one row per child page. Columns (and their values) live
// in the database, shared by every table on the same page; this block only
// stores how it's shown: its title, column order, hidden columns and sort.
//
// Laid out with divs (CSS display: table), not <table>: BlockNote's table
// extension treats any <td>/<th> under the mouse as part of a BlockNote
// table block and throws on ours.

type Sort = { key: string; dir: "asc" | "desc" } | null;

export const childTableBlock = createReactBlockSpec(
  BLOCK_CONFIGS.childTable,
  {
    render: ({ block, editor }) => (
      <ChildTable
        title={block.props.title}
        order={parseKeys(block.props.order)}
        hidden={parseKeys(block.props.hidden)}
        sort={parseSort(block.props.sort)}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
  },
);

function parseKeys(raw: string): string[] {
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

// Runs a Server Action and shows its error (or a failure to reach it).
function useRun() {
  const failed = useTranslations("editor.save")("failed");
  return async (action: Promise<{ error?: string }>) => {
    const result = await action.catch(() => ({ error: failed }));
    if (result.error) await showAlert(result.error);
    return !result.error;
  };
}

// How cells show and sort in the viewer's language.
type Format = {
  dateTime: (iso: string) => string;
  displayTitle: (title: string) => string;
  collator: Intl.Collator;
};

// Saved order first (known keys only), then any other available keys.
function resolveOrder(saved: string[], available: string[]): string[] {
  const known = new Set(available);
  const ordered = saved.filter((k, i) => known.has(k) && saved.indexOf(k) === i);
  return [...ordered, ...available.filter((k) => !ordered.includes(k))];
}

type ColumnView = { key: string; label: string; custom: PropertyColumn | null };

function ChildTable({
  title,
  order,
  hidden,
  sort: savedSort,
  editable,
  onChange,
}: {
  title: string;
  order: string[];
  hidden: string[];
  sort: Sort;
  editable: boolean;
  onChange: (props: { title?: string; order?: string; hidden?: string; sort?: string }) => void;
}) {
  const router = useRouter();
  const { pageId } = usePageEditor();
  const { data, reload } = useChildrenData(loadChildTable);
  // Read-only viewers can still sort for themselves; it just isn't saved.
  const [localSort, setLocalSort] = useState<Sort | undefined>(undefined);
  const sort = editable ? savedSort : localSort === undefined ? savedSort : localSort;
  const setSort = (next: Sort) =>
    editable ? onChange({ sort: next ? `${next.key}:${next.dir}` : "" }) : setLocalSort(next);
  const [menu, setMenu] = useState<string | null>(null);
  // Column being dragged by its grip, and where it would land (index into
  // the visible columns, 0 = right after the title).
  const [drag, setDrag] = useState<{ key: string; dropIndex: number } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("editor");
  const run = useRun();
  const formatter = useFormatter();
  const locale = useLocale();
  const displayTitle = useDisplayTitle();
  const format = useMemo<Format>(
    () => ({
      dateTime: (iso) => formatter.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" }),
      displayTitle,
      collator: new Intl.Collator(locale),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayTitle and formatter follow the locale
    [locale],
  );

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const allColumns = useMemo<ColumnView[]>(() => {
    const custom = (data?.columns ?? []).map((c) => ({ key: c.id, label: c.name, custom: c }));
    const builtin = BUILTIN_COLUMNS.map((k) => ({ key: k, label: t(`childTable.builtin.${k}`), custom: null }));
    const byKey = new Map([...custom, ...builtin].map((c) => [c.key, c]));
    return resolveOrder(order, [...byKey.keys()]).map((k) => byKey.get(k)!);
  }, [data, order, t]);
  const visible = allColumns.filter((c) => !hiddenSet.has(c.key));

  const rows = useMemo(() => (data ? sortRows(data, sort, format) : []), [data, sort, format]);

  if (data === undefined) {
    return <Frame title={title}>{t("loading")}</Frame>;
  }
  if (data === null) {
    return <Frame title={title}>{t("childTable.cannotShow")}</Frame>;
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
  // EDIT on this page: may add child pages (and columns).
  const canCreate = editable && data.canEditColumns;

  // Moves a visible column to `toIndex` among the visible ones; hidden
  // columns keep their place in the saved order.
  const moveTo = (key: string, toIndex: number) => {
    const keys = visible.map((c) => c.key);
    const from = keys.indexOf(key);
    if (from < 0) return;
    keys.splice(from, 1);
    keys.splice(toIndex > from ? toIndex - 1 : toIndex, 0, key);
    const queue = [...keys];
    const full = allColumns.map((c) => (hiddenSet.has(c.key) ? c.key : queue.shift()!));
    onChange({ order: JSON.stringify(full) });
  };
  // Insertion index for the pointer's x: before the first visible column
  // whose middle is right of it.
  const dropIndexAt = (clientX: number) => {
    const cells = [...(headerRef.current?.querySelectorAll<HTMLElement>("[data-col-key]") ?? [])];
    const index = cells.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return clientX < r.left + r.width / 2;
    });
    return index < 0 ? cells.length : index;
  };
  const gripHandlers = (key: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ key, dropIndex: visible.findIndex((c) => c.key === key) });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (drag?.key === key) setDrag({ key, dropIndex: dropIndexAt(e.clientX) });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      if (drag?.key !== key) return;
      const to = dropIndexAt(e.clientX);
      const from = visible.findIndex((c) => c.key === key);
      setDrag(null);
      if (to !== from && to !== from + 1) moveTo(key, to);
    },
    onPointerCancel: () => setDrag(null),
  });

  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildTableBlock">
      <div className={styles.header}>
        <BlockTitle
          value={title}
          placeholder={t("childTable.placeholder")}
          editable={editable}
          onSave={(next) => onChange({ title: next })}
          uiName="ChildTableBlock"
        />
        {editable && (
          <Popover
            open={menu === "columns"}
            onOpenChange={(o) => setMenu(o ? "columns" : null)}
            trigger={t("childTable.columns")}
            dataUi="ChildTableBlock.columnsMenu"
          >
            {allColumns.map(({ key, label }) => (
              <label key={key} className={styles.check}>
                <input type="checkbox" checked={!hiddenSet.has(key)} onChange={() => toggleHidden(key)} />
                {label}
              </label>
            ))}
          </Popover>
        )}
        {editable && data.canEditColumns && (
          <Popover
            open={menu === "add"}
            onOpenChange={(o) => setMenu(o ? "add" : null)}
            trigger={t("childTable.addColumn")}
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

      {rows.length === 0 && !canCreate ? (
        <p className={styles.muted}>{t("childPages.none")}</p>
      ) : (
        <div className={styles.tableScroll}>
          <div className={drag ? styles.tableDragging : styles.table} role="table">
            <div className={styles.tr} role="row" ref={headerRef}>
              <HeaderCell label={t("childTable.title")} sortKey="title" sort={sort} onSort={setSort} />
              {visible.map((c, i) => (
                <HeaderCell
                  key={c.key}
                  colKey={c.key}
                  label={c.label}
                  sortKey={c.key}
                  sort={sort}
                  onSort={setSort}
                  grip={editable ? gripHandlers(c.key) : undefined}
                  dragging={drag?.key === c.key}
                  dropBefore={drag !== null && drag.dropIndex === i}
                  dropAfter={drag !== null && drag.dropIndex === visible.length && i === visible.length - 1}
                  menuOpen={menu === `col:${c.key}`}
                  onMenuOpenChange={editable ? (o) => setMenu(o ? `col:${c.key}` : null) : undefined}
                >
                  <ColumnMenu
                    column={c.custom}
                    label={c.label}
                    canEditColumn={data.canEditColumns}
                    first={i === 0}
                    last={i === visible.length - 1}
                    onRename={(name) => c.custom && after(renameColumn(c.custom.id, name))}
                    onOptions={(options) => c.custom && after(setColumnOptions(c.custom.id, options))}
                    onMove={(dir) => moveTo(c.key, dir < 0 ? i - 1 : i + 2)}
                    onHide={() => {
                      setMenu(null);
                      toggleHidden(c.key);
                    }}
                    onDelete={() => {
                      const custom = c.custom;
                      if (!custom) return;
                      void showConfirm(t("childTable.deleteColumn", { name: c.label }), {
                        title: t("childTable.deleteColumnTitle"),
                        confirmLabel: t("childTable.remove"),
                        danger: true,
                      }).then((ok) => {
                        if (!ok) return;
                        setMenu(null);
                        void after(deleteColumn(custom.id));
                      });
                    }}
                  />
                </HeaderCell>
              ))}
            </div>
            {rows.map((row) => (
              <div key={row.id} className={styles.tr} role="row" data-ui="ChildTableBlock.row" data-id={row.id}>
                <div className={styles.titleCell} role="cell">
                  <PageLink href={`/pages/${row.id}`} className={styles.pageLink} data-ui="ChildTableBlock.pageLink" data-id={row.id}>
                    <span aria-hidden>{row.icon ?? "📄"}</span>
                    <span>{displayTitle(row.title)}</span>
                  </PageLink>
                </div>
                {visible.map((c) => (
                  <div
                    key={c.key}
                    role="cell"
                    className={c.custom ? styles.cell : styles.metaCell}
                    data-dragging={drag?.key === c.key || undefined}
                  >
                    {c.custom ? (
                      <Cell
                        column={c.custom}
                        value={row.values[c.custom.id] ?? ""}
                        editable={editable && row.canEdit}
                        data={data}
                        onSave={(value) => after(setCellValue(row.id, c.custom!.id, value))}
                      />
                    ) : (
                      builtinText(row, c.key as BuiltinColumn, data, format)
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {canCreate && (
            <div className={styles.newRow}>
              <NewPageRow
                onCreate={async (pageTitle) => {
                  const result = await createChildPageInPlace(pageId, pageTitle).catch(() => ({
                    error: t("childTable.createFailed"),
                  }));
                  if ("error" in result) {
                    void showAlert(result.error, { title: t("childTable.cannotCreate") });
                    return false;
                  }
                  void reload();
                  // The sidebar lists the new page too.
                  router.refresh();
                  return true;
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  const t = useTranslations("editor.childTable");
  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildTableBlock">
      <div className={styles.header}>
        <BlockTitle value={title} placeholder={t("placeholder")} editable={false} onSave={() => {}} uiName="ChildTableBlock" />
      </div>
      <p className={styles.muted}>{children}</p>
    </div>
  );
}

function builtinText(row: ChildTableRow, key: BuiltinColumn, data: ChildTableData, format: Format): string {
  switch (key) {
    case "createdAt":
      return format.dateTime(row.createdAt);
    case "updatedAt":
      return format.dateTime(row.updatedAt);
    case "createdBy":
      return data.userNames[row.createdById] ?? "";
    case "updatedBy":
      return row.updatedById ? (data.userNames[row.updatedById] ?? "") : "";
  }
}

// Sort key of one cell; empty cells always go last.
function sortValue(row: ChildTableRow, key: string, data: ChildTableData, format: Format): string | number | null {
  if (key === "title") return format.displayTitle(row.title);
  if (key === "createdAt" || key === "updatedAt") return Date.parse(row[key]);
  if (key === "createdBy" || key === "updatedBy") return builtinText(row, key, data, format) || null;
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

function sortRows(data: ChildTableData, sort: Sort, format: Format): ChildTableRow[] {
  if (!sort) return data.rows;
  const { collator } = format;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...data.rows].sort((a, b) => {
    const x = sortValue(a, sort.key, data, format);
    const y = sortValue(b, sort.key, data, format);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return cmp * sign;
  });
}

function HeaderCell({
  colKey,
  label,
  sortKey,
  sort,
  onSort,
  grip,
  dragging,
  dropBefore,
  dropAfter,
  menuOpen,
  onMenuOpenChange,
  children,
}: {
  // Set on movable columns (the title column has none); used to find drop positions.
  colKey?: string;
  label: string;
  sortKey: string;
  sort: Sort;
  onSort: (sort: Sort) => void;
  // Pointer handlers for the drag grip; absent when not editable.
  grip?: Partial<Record<"onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel", (e: ReactPointerEvent<HTMLElement>) => void>>;
  dragging?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const active = sort?.key === sortKey ? sort.dir : null;
  const t = useTranslations("editor.childTable");
  // Click cycles: ascending → descending → creation order.
  const next: Sort = active === null ? { key: sortKey, dir: "asc" } : active === "asc" ? { key: sortKey, dir: "desc" } : null;
  return (
    <div
      role="columnheader"
      className={styles.headCell}
      data-col-key={colKey}
      data-dragging={dragging || undefined}
      data-drop={dropBefore ? "before" : dropAfter ? "after" : undefined}
    >
      <div className={styles.th}>
        {grip && (
          <span
            className={styles.grip}
            title={t("dragColumn")}
            aria-hidden
            data-ui="ChildTableBlock.columnGrip"
            data-key={colKey}
            {...grip}
          >
            ⋮⋮
          </span>
        )}
        <button type="button" className={styles.thButton} onClick={() => onSort(next)} title={t("sort")}>
          {label}
          {active && <span aria-hidden>{active === "asc" ? " ↑" : " ↓"}</span>}
        </button>
        {onMenuOpenChange && (
          <Popover open={!!menuOpen} onOpenChange={onMenuOpenChange} trigger="⋯" label={t("columnSettings")} dataUi="ChildTableBlock.columnMenu">
            {children}
          </Popover>
        )}
      </div>
    </div>
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
  const t = useTranslations("editor.childTable");
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
        placeholder={t("columnNamePlaceholder")}
        maxLength={50}
        autoFocus
        required
      />
      <select className={styles.input} value={type} onChange={(e) => setType(e.target.value as PropertyType)}>
        {PROPERTY_TYPES.map((p) => (
          <option key={p} value={p}>
            {t(`types.${p}`)}
          </option>
        ))}
      </select>
      <button type="submit" className={styles.primaryButton}>
        {t("add")}
      </button>
    </form>
  );
}

function ColumnMenu({
  column,
  label,
  canEditColumn,
  first,
  last,
  onRename,
  onOptions,
  onMove,
  onHide,
  onDelete,
}: {
  // Null for built-in columns (created at, etc.): only moving and hiding apply.
  column: PropertyColumn | null;
  label: string;
  // EDIT on the page: may rename / delete the column itself.
  canEditColumn: boolean;
  first: boolean;
  last: boolean;
  onRename: (name: string) => void;
  onOptions: (options: SelectOption[]) => void;
  onMove: (dir: -1 | 1) => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(label);
  const t = useTranslations("editor.childTable");
  return (
    <div className={styles.form}>
      <div className={styles.muted}>{t("type", { type: column ? t(`types.${column.type}`) : t("automatic") })}</div>
      {column && canEditColumn && (
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            onRename(name);
          }}
        >
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
          <button type="submit" className={styles.toolButton}>
            {t("rename")}
          </button>
        </form>
      )}
      {column?.type === "SELECT" && canEditColumn && <OptionsEditor options={column.options} onSave={onOptions} />}
      <div className={styles.row}>
        <button type="button" className={styles.toolButton} disabled={first} onClick={() => onMove(-1)}>
          {t("left")}
        </button>
        <button type="button" className={styles.toolButton} disabled={last} onClick={() => onMove(1)}>
          {t("right")}
        </button>
        <button type="button" className={styles.toolButton} onClick={onHide}>
          {t("hide")}
        </button>
        {column && canEditColumn && (
          <button type="button" className={styles.dangerButton} onClick={onDelete}>
            {t("remove")}
          </button>
        )}
      </div>
    </div>
  );
}

function newOptionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function OptionsEditor({ options, onSave }: { options: SelectOption[]; onSave: (options: SelectOption[]) => void }) {
  const [draft, setDraft] = useState(options);
  const t = useTranslations("editor.childTable");
  const update = (i: number, patch: Partial<SelectOption>) =>
    setDraft((d) => d.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className={styles.form}>
      <div className={styles.muted}>{t("options")}</div>
      {draft.map((o, i) => (
        <div key={o.id} className={styles.row}>
          <button
            type="button"
            className={styles.swatch}
            style={{ background: o.color }}
            title={t("changeColor")}
            onClick={() => update(i, { color: OPTION_COLORS[(OPTION_COLORS.indexOf(o.color) + 1) % OPTION_COLORS.length] })}
          />
          <input className={styles.input} value={o.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={50} />
          <button
            type="button"
            className={styles.toolButton}
            aria-label={t("removeOption")}
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
          {t("addOption")}
        </button>
        <button type="button" className={styles.primaryButton} onClick={() => onSave(draft.filter((o) => o.name.trim()))}>
          {t("saveOptions")}
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
  const t = useTranslations("editor.childTable");
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
    const name = value ? (data.userNames[value] ?? t("unknownUser")) : "";
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

// "+ New page": becomes a title field. Enter creates the page and keeps
// the field open for the next one; Esc, or leaving it empty, closes it.
function NewPageRow({ onCreate }: { onCreate: (title: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useTranslations("editor.childTable");
  if (!open) {
    return (
      <button
        type="button"
        className={styles.newRowButton}
        data-ui="ChildTableBlock.newPageButton"
        onClick={() => setOpen(true)}
      >
        {t("newPage")}
      </button>
    );
  }
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onCreate(title);
    setBusy(false);
    if (ok) setTitle("");
  };
  return (
    <input
      className={styles.newRowInput}
      data-ui="ChildTableBlock.newPageInput"
      value={title}
      placeholder={t("newPagePlaceholder")}
      maxLength={200}
      autoFocus
      readOnly={busy}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => {
        if (!title.trim() && !busy) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") void submit();
        if (e.key === "Escape") {
          setTitle("");
          setOpen(false);
        }
      }}
    />
  );
}
