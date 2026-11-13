"use client";

import { PageLink } from "./page-link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  loadTableView,
  renameColumn,
  saveTableView,
  setCellValue,
  setColumnOptions,
} from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { EMPTY_VIEW, isEmptyView, matchesFilters, type CellReader, type FilterCondition, type TableView } from "@/lib/table-view";
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
import { MaskProvider, MaskedCell, MaskedColumnToggle } from "./masked-cell";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-blocks.module.css";
import { showAlert, showConfirm } from "@/components/dialog";
import { BLOCK_CONFIGS } from "./block-configs";
import { beginSaving } from "@/lib/saving-status";

// Child page table: one row per child page. Columns (and their values) live
// in the database, shared by every table on the same page; this block only
// stores how it's shown: its title, column order, hidden columns and sort.
// On top of that, everyone can filter and sort for themselves; that view is
// saved to their account (lib/table-view.ts), not to the block.
//
// Laid out with divs (CSS display: table), not <table>: BlockNote's table
// extension treats any <td>/<th> under the mouse as part of a BlockNote
// table block and throws on ours.

export type Sort = { key: string; dir: "asc" | "desc" } | null;

export const childTableBlock = createReactBlockSpec(
  BLOCK_CONFIGS.childTable,
  {
    render: ({ block, editor }) => (
      <ChildTable
        blockId={block.id}
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

export function parseSort(raw: string): Sort {
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
export type Format = {
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

export type ColumnView = { key: string; label: string; custom: PropertyColumn | null };

function ChildTable({
  blockId,
  title,
  order,
  hidden,
  sort: savedSort,
  editable,
  onChange,
}: {
  blockId: string;
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
  // The viewer's own filters and sort, over the table's. Sorting by a header
  // is always their own; an editor can then make it the table's sort.
  const { view, setView, personal } = usePersonalView(pageId, blockId);
  const sort = view.sort === null ? savedSort : parseSort(view.sort);
  const setSort = (next: Sort) => setView({ ...view, sort: next ? `${next.key}:${next.dir}` : "" });
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
  // A masked column's values, to check a passphrase against (masked-cell.tsx).
  const maskValues = useCallback((columnId: string) => (data?.rows ?? []).map((r) => r.values[columnId] ?? ""), [data]);

  const sorted = useMemo(() => (data ? sortRows(data, sort, format) : []), [data, sort, format]);
  const filterCount = Object.keys(view.filters).length;
  const rows = useMemo(() => {
    if (!data || filterCount === 0) return sorted;
    const known = new Set(["title", ...allColumns.map((c) => c.key)]);
    return sorted.filter((row) => matchesFilters(view.filters, known, cellReader(row, data, format)));
  }, [sorted, data, view.filters, filterCount, allColumns, format]);

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
    const ok = await run(action);
    if (ok) void reload();
    return ok;
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
    <MaskProvider values={maskValues}>
      <div className={styles.block} contentEditable={false} data-ui="ChildTableBlock">
        <div className={styles.header}>
          <BlockTitle
            value={title}
            placeholder={t("childTable.placeholder")}
            editable={editable}
            onSave={(next) => onChange({ title: next })}
            uiName="ChildTableBlock"
          />
          <Popover
            open={menu === "filter"}
            onOpenChange={(o) => setMenu(o ? "filter" : null)}
            trigger={filterCount > 0 ? t("childTable.filterCount", { count: filterCount }) : t("childTable.filter")}
            dataUi="ChildTableBlock.filterMenu"
          >
            <FilterPanel
              columns={[{ key: "title", label: t("childTable.title"), custom: null }, ...visible.filter((c) => c.custom?.type !== "MASKED")]}
              data={data}
              filters={view.filters}
              onChange={(filters) => setView({ ...view, filters })}
            />
          </Popover>
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

        {!isEmptyView(view) && (
          <div className={styles.viewBar} role="status" data-ui="ChildTableBlock.viewStatus">
            <span>
              {personal ? t("childTable.personalView") : t("childTable.screenView")}
              {filterCount > 0 && ` · ${t("childTable.shownRows", { shown: rows.length, total: data.rows.length })}`}
            </span>
            {editable && view.sort !== null && view.sort !== (savedSort ? `${savedSort.key}:${savedSort.dir}` : "") && (
              <button
                type="button"
                className={styles.toolButton}
                data-ui="ChildTableBlock.setDefaultSortButton"
                onClick={() => {
                  onChange({ sort: view.sort ?? "" });
                  setView({ ...view, sort: null });
                }}
              >
                {t("childTable.makeDefaultSort")}
              </button>
            )}
            <button type="button" className={styles.toolButton} data-ui="ChildTableBlock.resetViewButton" onClick={() => setView(EMPTY_VIEW)}>
              {t("childTable.resetView")}
            </button>
          </div>
        )}

        {filterCount > 0 && rows.length === 0 && data.rows.length > 0 ? (
          <p className={styles.muted} data-ui="ChildTableBlock.noMatch">
            {t("childTable.noMatch")}
          </p>
        ) : rows.length === 0 && !canCreate ? (
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
                    addon={c.custom?.type === "MASKED" ? <MaskedColumnToggle columnId={c.custom.id} /> : undefined}
                  >
                    <ColumnMenu
                      column={c.custom}
                      label={c.label}
                      canEditColumn={data.canEditColumns}
                      first={i === 0}
                      last={i === visible.length - 1}
                      onRename={(name) => c.custom && after(renameColumn(c.custom.id, name))}
                      onOptions={async (options) => !!c.custom && after(setColumnOptions(c.custom.id, options))}
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
    </MaskProvider>
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

// The viewer's own view of this table: loaded from their account, saved back
// a moment after each change. `personal`: it's kept on the account (false
// for someone not logged in, whose view lasts while the page is open).
export function usePersonalView(pageId: string, blockId: string) {
  const [view, setViewState] = useState<TableView>(EMPTY_VIEW);
  const [personal, setPersonal] = useState(false);
  const failed = useTranslations("editor.save")("failed");
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void; done: () => void } | null>(null);
  // Changed here before the saved view arrived: keep what was chosen.
  const touched = useRef(false);

  useEffect(() => {
    let stale = false;
    loadTableView(pageId, blockId)
      .then((saved) => {
        if (stale) return;
        setPersonal(saved !== null);
        if (saved && !touched.current) setViewState(saved);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [pageId, blockId]);

  // A change still waiting is saved at once when the table goes away.
  useEffect(
    () => () => {
      if (!pending.current) return;
      clearTimeout(pending.current.timer);
      pending.current.save();
    },
    [],
  );

  const setView = (next: TableView) => {
    touched.current = true;
    setViewState(next);
    if (!personal) return;
    // The change it replaces won't be saved by itself: this one covers it.
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current.done();
    }
    const done = beginSaving();
    const save = () => {
      pending.current = null;
      saveTableView(pageId, blockId, isEmptyView(next) ? null : next)
        .then((result) => {
          if (result.error) void showAlert(result.error);
        })
        .catch(() => void showAlert(failed))
        .finally(done);
    };
    pending.current = { timer: setTimeout(save, 500), save, done };
  };

  return { view, setView, personal };
}

// A local date (YYYY-MM-DD) from an ISO time, to compare with the filter's.
function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// How the filters read a row's cells (lib/table-view.ts).
export function cellReader(row: ChildTableRow, data: ChildTableData, format: Format): CellReader {
  const column = (key: string) => data.columns.find((c) => c.id === key);
  return {
    text(key) {
      if (key === "title") return format.displayTitle(row.title);
      const c = column(key);
      const value = row.values[key] ?? "";
      if (!c) return "";
      if (c.type === "SELECT") return c.options.find((o) => o.id === value)?.name ?? "";
      if (c.type === "USER") return value ? (data.userNames[value] ?? "") : "";
      if (c.type === "MASKED") return "";
      return value;
    },
    value(key) {
      if (key === "createdBy") return row.createdById;
      if (key === "updatedBy") return row.updatedById ?? "";
      const c = column(key);
      const value = row.values[key] ?? "";
      // An option that has since been removed counts as empty.
      if (c?.type === "SELECT" && !c.options.some((o) => o.id === value)) return "";
      return value;
    },
    date(key) {
      if (key === "createdAt" || key === "updatedAt") return localDate(row[key]);
      return row.values[key] ?? "";
    },
  };
}

type FilterKind = "text" | "values" | "dates";

function filterKindOf(column: ColumnView): FilterKind {
  if (!column.custom) {
    if (column.key === "title") return "text";
    return column.key === "createdAt" || column.key === "updatedAt" ? "dates" : "values";
  }
  const type = column.custom.type;
  return type === "SELECT" || type === "USER" ? "values" : type === "DATE" ? "dates" : "text";
}

// One row per column (the title and the visible columns): words for text,
// ticks for options and people, a from–to range for dates.
export function FilterPanel({
  columns,
  data,
  filters,
  onChange,
}: {
  columns: ColumnView[];
  data: ChildTableData;
  filters: TableView["filters"];
  onChange: (filters: TableView["filters"]) => void;
}) {
  const t = useTranslations("editor.childTable");
  const set = (key: string, condition: FilterCondition | null) => {
    const next = { ...filters };
    if (condition) next[key] = condition;
    else delete next[key];
    onChange(next);
  };
  // Choices for a "values" column: its options, or the people in it (and,
  // for a user column, everyone who can be chosen).
  const choicesOf = (column: ColumnView): { id: string; name: string }[] => {
    if (column.custom?.type === "SELECT") return column.custom.options.map((o) => ({ id: o.id, name: o.name }));
    const ids = new Set<string>();
    for (const r of data.rows) {
      const id = column.key === "createdBy" ? r.createdById : column.key === "updatedBy" ? r.updatedById : r.values[column.key];
      if (id) ids.add(id);
    }
    if (column.custom?.type === "USER") for (const u of data.assignees) ids.add(u.id);
    // No names (someone not logged in): nothing to choose from.
    return [...ids].filter((id) => data.userNames[id]).map((id) => ({ id, name: data.userNames[id] }));
  };

  return (
    <div className={styles.filterPanel} data-ui="FilterPanel">
      {columns.map((column) => {
        const kind = filterKindOf(column);
        const condition = filters[column.key];
        if (kind === "text") {
          const q = condition?.kind === "text" ? condition.q : "";
          return (
            <label key={column.key} className={styles.filterRow}>
              <span className={styles.filterLabel}>{column.label}</span>
              <input
                className={styles.input}
                value={q}
                maxLength={200}
                placeholder={t("filterContains")}
                onChange={(e) => set(column.key, e.target.value.trim() ? { kind: "text", q: e.target.value } : null)}
                data-ui="FilterPanel.textInput"
                data-key={column.key}
              />
            </label>
          );
        }
        if (kind === "dates") {
          const range = condition?.kind === "dates" ? condition : { from: "", to: "" };
          const update = (patch: Partial<{ from: string; to: string }>) => {
            const next = { ...range, ...patch };
            set(column.key, next.from || next.to ? { kind: "dates", from: next.from, to: next.to } : null);
          };
          return (
            <div key={column.key} className={styles.filterRow}>
              <span className={styles.filterLabel}>{column.label}</span>
              <span className={styles.row}>
                <input
                  type="date"
                  className={styles.input}
                  value={range.from}
                  aria-label={t("filterFrom", { name: column.label })}
                  onChange={(e) => update({ from: e.target.value })}
                  data-ui="FilterPanel.fromInput"
                  data-key={column.key}
                />
                〜
                <input
                  type="date"
                  className={styles.input}
                  value={range.to}
                  aria-label={t("filterTo", { name: column.label })}
                  onChange={(e) => update({ to: e.target.value })}
                  data-ui="FilterPanel.toInput"
                  data-key={column.key}
                />
              </span>
            </div>
          );
        }
        const choices = choicesOf(column);
        if (choices.length === 0 && column.custom?.type !== "SELECT") return null;
        const ids = condition?.kind === "values" ? condition.ids : [];
        const toggle = (id: string) => {
          const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
          set(column.key, next.length ? { kind: "values", ids: next } : null);
        };
        return (
          <div key={column.key} className={styles.filterRow}>
            <span className={styles.filterLabel}>{column.label}</span>
            <span className={styles.filterChoices}>
              {[...choices, { id: "", name: t("filterEmpty") }].map((choice) => (
                <label key={choice.id || "(empty)"} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={ids.includes(choice.id)}
                    onChange={() => toggle(choice.id)}
                    data-ui="FilterPanel.choiceCheckbox"
                    data-key={column.key}
                    data-id={choice.id}
                  />
                  {choice.name}
                </label>
              ))}
            </span>
          </div>
        );
      })}
      {Object.keys(filters).length > 0 && (
        <div className={styles.row}>
          <button type="button" className={styles.toolButton} onClick={() => onChange({})} data-ui="FilterPanel.clearButton">
            {t("filterClear")}
          </button>
        </div>
      )}
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
  if (!column || !value || column.type === "MASKED") return null;
  if (column.type === "USER") return data.userNames[value] ?? null;
  if (column.type === "SELECT") {
    const index = column.options.findIndex((o) => o.id === value);
    return index < 0 ? null : index;
  }
  return value;
}

export function sortRows(data: ChildTableData, sort: Sort, format: Format): ChildTableRow[] {
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
  addon,
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
  // After the label (a masked column's Show / Hide).
  addon?: ReactNode;
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
        {addon}
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
export function Popover({
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
      data-ui="AddColumnForm"
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
        data-ui="AddColumnForm.nameInput"
        maxLength={50}
        autoFocus
        required
      />
      <select
        className={styles.input}
        value={type}
        onChange={(e) => setType(e.target.value as PropertyType)}
        data-ui="AddColumnForm.typeSelect"
      >
        {PROPERTY_TYPES.map((p) => (
          <option key={p} value={p}>
            {t(`types.${p}`)}
          </option>
        ))}
      </select>
      <button type="submit" className={styles.primaryButton} data-ui="AddColumnForm.submitButton">
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
  onOptions: (options: SelectOption[]) => Promise<boolean>;
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

// The options as they'd be saved (blank names dropped), to compare with the
// saved ones.
const cleanOptions = (options: SelectOption[]) => options.filter((o) => o.name.trim());
const sameOptions = (a: SelectOption[], b: SelectOption[]) =>
  JSON.stringify(cleanOptions(a).map((o) => [o.id, o.name.trim(), o.color])) ===
  JSON.stringify(cleanOptions(b).map((o) => [o.id, o.name.trim(), o.color]));

// Says what became of the edits: not saved yet, saving, saved (until the next
// edit). The panel stays open, so this is the only sign a save went through.
function OptionsEditor({ options, onSave }: { options: SelectOption[]; onSave: (options: SelectOption[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState(options);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const t = useTranslations("editor.childTable");
  const dirty = !sameOptions(draft, options);
  const edit = (next: (d: SelectOption[]) => SelectOption[]) => {
    setStatus("idle");
    setDraft(next);
  };
  const update = (i: number, patch: Partial<SelectOption>) => edit((d) => d.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const save = async () => {
    setStatus("saving");
    const done = beginSaving();
    const ok = await onSave(cleanOptions(draft)).finally(done);
    setStatus(ok ? "saved" : "idle");
  };
  const statusText =
    status === "saving" ? t("optionsSaving") : status === "saved" && !dirty ? `✓ ${t("optionsSaved")}` : dirty ? t("optionsUnsaved") : "";
  return (
    <div className={styles.form} data-ui="OptionsEditor">
      <div className={styles.muted}>{t("options")}</div>
      {draft.map((o, i) => (
        <div key={o.id} className={styles.row}>
          <button
            type="button"
            className={styles.swatch}
            style={{ background: o.color }}
            title={t("changeColor")}
            data-ui="OptionsEditor.colorButton"
            onClick={() => update(i, { color: OPTION_COLORS[(OPTION_COLORS.indexOf(o.color) + 1) % OPTION_COLORS.length] })}
          />
          <input
            className={styles.input}
            value={o.name}
            onChange={(e) => update(i, { name: e.target.value })}
            maxLength={50}
            data-ui="OptionsEditor.nameInput"
          />
          <button
            type="button"
            className={styles.toolButton}
            aria-label={t("removeOption")}
            data-ui="OptionsEditor.removeButton"
            onClick={() => edit((d) => d.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.toolButton}
          data-ui="OptionsEditor.addButton"
          onClick={() =>
            edit((d) => [...d, { id: newOptionId(), name: "", color: OPTION_COLORS[d.length % OPTION_COLORS.length] }])
          }
        >
          {t("addOption")}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          data-ui="OptionsEditor.saveButton"
          disabled={status === "saving" || !dirty}
          onClick={() => void save()}
        >
          {t("saveOptions")}
        </button>
      </div>
      {statusText && (
        <div
          className={status === "saved" && !dirty ? styles.savedStatus : styles.muted}
          role="status"
          data-ui="OptionsEditor.status"
        >
          {statusText}
        </div>
      )}
    </div>
  );
}

// One custom column's value; also the page's properties under its title
// (page-properties.tsx).
export function Cell({
  column,
  value,
  editable,
  data,
  onSave,
}: {
  column: PropertyColumn;
  value: string;
  editable: boolean;
  data: Pick<ChildTableData, "assignees" | "userNames">;
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

  if (column.type === "MASKED") {
    return (
      <MaskedCell
        columnId={column.id}
        value={value}
        editable={editable}
        onSave={onSave}
        editor={(text, save) => <TextCell value={text} onSave={save} />}
      />
    );
  }

  if (column.type === "LONG_TEXT") {
    return editable ? <LongTextCell value={value} onSave={onSave} /> : <span className={styles.longText}>{value}</span>;
  }
  if (!editable) return <span className={styles.text}>{value}</span>;
  return <TextCell value={value} onSave={onSave} />;
}

// How much of a long text a cell shows in full; a longer one scrolls inside
// the cell (or the cell is dragged taller).
const LONG_TEXT_SHOWN = 200;

// Tall enough for the first LONG_TEXT_SHOWN characters of the text, measured
// on a hidden copy of the textarea (same width and font) holding only those.
function fitLongText(el: HTMLTextAreaElement) {
  const probe = el.cloneNode() as HTMLTextAreaElement;
  probe.value = el.value.slice(0, LONG_TEXT_SHOWN);
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", height: "auto", width: `${el.offsetWidth}px` });
  probe.rows = 1;
  el.parentElement?.appendChild(probe);
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${probe.scrollHeight + border}px`;
  probe.remove();
}

// Like TextCell, over several lines: Enter starts a new line, Ctrl/Cmd+Enter
// or leaving the cell saves, Esc restores. Grows with its text, up to
// LONG_TEXT_SHOWN characters.
function LongTextCell({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = editing ? draft : value;
  useLayoutEffect(() => {
    if (ref.current) fitLongText(ref.current);
  }, [shown]);
  return (
    <textarea
      ref={ref}
      className={`${styles.cellInput} ${styles.cellTextarea}`}
      data-ui="LongTextCell"
      value={shown}
      rows={1}
      maxLength={10000}
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
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
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
