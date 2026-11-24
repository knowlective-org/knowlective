"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { addDateColumn, loadCalendarTable, setCellValue } from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { createChildPageInPlace } from "@/app/(app)/actions";
import { showAlert } from "@/components/dialog";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { useReportSaving } from "@/lib/saving-status";
import { matchesFilters } from "@/lib/table-view";
import { BUILTIN_COLUMNS, type ChildTableData, type ChildTableRow } from "@/lib/page-property-types";
import { BlockTitle } from "./block-title";
import { PageLink } from "./page-link";
import { useChildrenData, usePageEditor } from "./page-context";
import { LinkedSource, LinkedUnsetNote, useLinkedPlaceholder, useLinkedView } from "./linked-view";
import { type ColumnView, type Format, FilterPanel, Popover, cellReader, usePersonalView } from "./child-table-block";
import { type Month, addMonths, localDay, monthOf, monthWeeks, todayKey } from "./calendar";
import { CalendarAddInput } from "./calendar-add-input";
import { ChildGantt, type GanttSpan } from "./child-gantt";
import { GANTT_RANGES, type GanttRange, isGanttRange, pageSpan } from "./gantt";
import { BLOCK_CONFIGS } from "./block-configs";
import styles from "./child-calendar-block.module.css";

// Child page calendar: the page's child pages on a month's calendar, each on
// the day in a date column — the same pages, columns and values as the child
// page table and board, shown another way. Dragging a card to another day
// sets that page's date (onto "no date": clears it); "+" on a day adds a
// child page there. The block only stores its title and which column holds
// the dates; the month shown is each viewer's own (not saved), as is the
// filter (saved on their account, as the table's).
//
// The dates can also come from when pages were created or last changed
// (read only: nothing to set by dragging).
//
// The block can show the same pages as a Gantt chart (child-gantt.tsx), from a
// start and an end date column. Which view and how long a period it shows are
// the block's, for everyone.

const BUILTIN_DATES = ["createdAt", "updatedAt"] as const;

export const childCalendarBlock = createReactBlockSpec(BLOCK_CONFIGS.childCalendar, {
  render: ({ block, editor }) => (
    <ChildCalendar
      blockId={block.id}
      title={block.props.title}
      dateBy={block.props.dateBy}
      endBy={block.props.endBy}
      layout={block.props.layout === "gantt" ? "gantt" : "calendar"}
      ganttRange={isGanttRange(block.props.ganttRange) ? block.props.ganttRange : "month"}
      source={block.props.source}
      editable={editor.isEditable}
      onChange={(props) => editor.updateBlock(block, { props })}
    />
  ),
});

function ChildCalendar({
  blockId,
  title,
  dateBy,
  endBy,
  layout,
  ganttRange,
  source,
  editable,
  onChange,
}: {
  blockId: string;
  title: string;
  dateBy: string;
  endBy: string;
  layout: "calendar" | "gantt";
  ganttRange: GanttRange;
  source: string;
  editable: boolean;
  onChange: (props: { title?: string; dateBy?: string; endBy?: string; layout?: "calendar" | "gantt"; ganttRange?: GanttRange; source?: string }) => void;
}) {
  const { pageId } = usePageEditor();
  const router = useRouter();
  // A linked view (lib/linked-views.ts) shows another page's child pages and
  // leaves its columns alone.
  const { linked, sourceId } = useLinkedView(source);
  const parentId = sourceId || pageId;
  const { data, reload } = useChildrenData(loadCalendarTable, sourceId);
  const linkedPlaceholder = useLinkedPlaceholder("childCalendar", data?.page);
  const t = useTranslations("editor");
  const failed = t("save.failed");
  const formatter = useFormatter();
  const locale = useLocale();
  const displayTitle = useDisplayTitle();
  const [month, setMonth] = useState<Month>(() => monthOf(todayKey())!);
  // Dates shown before the server has them: page id → date ("" = none).
  const [moved, setMoved] = useState<Record<string, string>>({});
  // The same for end dates (Gantt chart).
  const [movedEnd, setMovedEnd] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const { view, setView } = usePersonalView(pageId, blockId);
  const [filterOpen, setFilterOpen] = useState(false);
  const saving = Object.keys(moved).length + Object.keys(movedEnd).length > 0;
  useReportSaving(saving);

  const format = useMemo<Format>(
    () => ({
      dateTime: (iso) => formatter.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" }),
      displayTitle,
      collator: new Intl.Collator(locale),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayTitle and formatter follow the locale
    [locale],
  );

  const dateColumns = data?.columns.filter((c) => c.type === "DATE") ?? [];
  // The column chosen; else the first date column; else nothing (a built-in
  // one only when chosen).
  const builtin = (BUILTIN_DATES as readonly string[]).includes(dateBy) ? (dateBy as (typeof BUILTIN_DATES)[number]) : null;
  const column = builtin ? null : (dateColumns.find((c) => c.id === dateBy) ?? dateColumns[0] ?? null);
  const settable = !!column && editable;
  // The end dates' column: the one chosen, else the next date column.
  const others = dateColumns.filter((c) => c.id !== column?.id);
  const endColumn = endBy === "none" ? null : (others.find((c) => c.id === endBy) ?? others[0] ?? null);

  const filterColumns = useMemo<ColumnView[]>(
    () => [
      { key: "title", label: t("childTable.title"), custom: null },
      ...(data?.columns ?? []).filter((c) => c.type !== "MASKED").map((c) => ({ key: c.id, label: c.name, custom: c })),
      ...BUILTIN_COLUMNS.map((k) => ({ key: k, label: t(`childTable.builtin.${k}`), custom: null })),
    ],
    [data, t],
  );
  const filterCount = Object.keys(view.filters).length;
  const rows = useMemo(() => {
    if (!data) return [];
    if (filterCount === 0) return data.rows;
    const known = new Set(filterColumns.map((c) => c.key));
    return data.rows.filter((row) => matchesFilters(view.filters, known, cellReader(row, data, format)));
  }, [data, view.filters, filterCount, filterColumns, format]);

  const dateOf = (row: ChildTableRow): string => {
    if (builtin) return localDay(row[builtin]);
    if (!column) return "";
    const value = moved[row.id] ?? row.values[column.id] ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  };
  const endOf = (row: ChildTableRow): string => (endColumn ? (movedEnd[row.id] ?? row.values[endColumn.id] ?? "") : "");
  const spanOf = (row: ChildTableRow): GanttSpan | null => {
    const end = endOf(row);
    const span = pageSpan(dateOf(row), end);
    return span && { ...span, hasEnd: !!end && end === span.end };
  };
  // Both of a page's dates, each saved only if it changed.
  const setSpan = async (row: ChildTableRow, start: string, end: string) => {
    if (!column || !row.canEdit) return;
    const startChanged = dateOf(row) !== start;
    // No end given: the page's stays as it is (one before its start is
    // ignored on the chart, not erased).
    const endChanged = !!endColumn && !!end && endOf(row) !== end;
    if (!startChanged && !endChanged) return;
    if (startChanged) setMoved((m) => ({ ...m, [row.id]: start }));
    if (endChanged) setMovedEnd((m) => ({ ...m, [row.id]: end }));
    const write = async (columnId: string, value: string) => {
      const result = await setCellValue(row.id, columnId, value).catch(() => ({ error: failed }));
      return result.error ?? null;
    };
    // One after the other: the second isn't tried if the first is refused.
    const error = (startChanged ? await write(column.id, start) : null) ?? (endChanged ? await write(endColumn!.id, end) : null);
    if (error) await showAlert(error);
    await reload();
    const without = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== row.id));
    setMoved(without);
    setMovedEnd(without);
  };
  const byDay = new Map<string, ChildTableRow[]>();
  const undated: ChildTableRow[] = [];
  for (const row of rows) {
    const date = dateOf(row);
    if (!date) undated.push(row);
    else byDay.set(date, [...(byDay.get(date) ?? []), row]);
  }

  const setDate = async (row: ChildTableRow, date: string) => {
    if (!column || !row.canEdit || dateOf(row) === date) return;
    setMoved((m) => ({ ...m, [row.id]: date }));
    const result = await setCellValue(row.id, column.id, date).catch(() => ({ error: failed }));
    if (result.error) await showAlert(result.error);
    await reload();
    setMoved((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== row.id)));
  };
  const addPage = async (date: string, pageTitle: string) => {
    if (!column) return;
    const result = await createChildPageInPlace(parentId, pageTitle).catch(() => ({ error: t("save.createFailed") }));
    if ("error" in result) {
      await showAlert(result.error);
      return;
    }
    setMoved((m) => ({ ...m, [result.id]: date }));
    const set = await setCellValue(result.id, column.id, date).catch(() => ({ error: failed }));
    if (set.error) await showAlert(set.error);
    await reload();
    setMoved((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== result.id)));
    // The new page also belongs in the sidebar.
    router.refresh();
  };

  const sources = [
    ...dateColumns.map((c) => ({ value: c.id, label: c.name })),
    ...BUILTIN_DATES.map((k) => ({ value: k, label: t(`childTable.builtin.${k}`) })),
  ];

  const header = (
    <div className={styles.header}>
      <BlockTitle
        value={title}
        placeholder={linked ? linkedPlaceholder : t("childCalendar.placeholder")}
        editable={editable}
        onSave={(next) => onChange({ title: next })}
        uiName="ChildCalendarBlock"
      />
      {linked && (
        <LinkedSource blockId={blockId} source={source} page={data?.page} editable={editable} onChoose={(next) => onChange({ source: next })} />
      )}
      {data && (column || builtin) && (
        <Popover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          trigger={filterCount > 0 ? t("childTable.filterCount", { count: filterCount }) : t("childTable.filter")}
          dataUi="ChildCalendarBlock.filterMenu"
        >
          <FilterPanel columns={filterColumns} data={data} filters={view.filters} onChange={(filters) => setView({ ...view, filters })} />
        </Popover>
      )}
      {editable && data && (column || builtin) && (
        <div className={styles.segments} role="group" aria-label={t("childCalendar.layout")}>
          {(["calendar", "gantt"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={styles.segment}
              aria-pressed={layout === value}
              onClick={() => onChange({ layout: value })}
              data-ui="ChildCalendarBlock.layoutButton"
              data-id={value}
            >
              {t(`childCalendar.layouts.${value}`)}
            </button>
          ))}
        </div>
      )}
      {editable && data && (column || builtin) && layout === "gantt" && (
        <div className={styles.segments} role="group" aria-label={t("childCalendar.ganttRange")}>
          {GANTT_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.segment}
              aria-pressed={ganttRange === value}
              onClick={() => onChange({ ganttRange: value })}
              data-ui="ChildCalendarBlock.rangeButton"
              data-id={value}
            >
              {t(`childCalendar.ganttRanges.${value}`)}
            </button>
          ))}
        </div>
      )}
      {editable && data && (column || builtin) && sources.length > 1 && (
        <select
          className={styles.inlineSelect}
          data-ui="ChildCalendarBlock.dateBySelect"
          value={builtin ?? column?.id ?? ""}
          onChange={(e) => onChange({ dateBy: e.target.value })}
          aria-label={t("childCalendar.dateBy")}
        >
          {sources.map((s) => (
            <option key={s.value} value={s.value}>
              {t(layout === "gantt" ? "childCalendar.startByOption" : "childCalendar.dateByOption", { name: s.label })}
            </option>
          ))}
        </select>
      )}
      {editable && data && (column || builtin) && layout === "gantt" && others.length > 0 && (
        <select
          className={styles.inlineSelect}
          data-ui="ChildCalendarBlock.endBySelect"
          value={endColumn?.id ?? "none"}
          onChange={(e) => onChange({ endBy: e.target.value })}
          aria-label={t("childCalendar.endBy")}
        >
          <option value="none">{t("childCalendar.noEnd")}</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {t("childCalendar.endByOption", { name: c.name })}
            </option>
          ))}
        </select>
      )}
      {editable && data?.canEditColumns && !linked && column && layout === "gantt" && others.length === 0 && (
        <button
          type="button"
          className={styles.todayButton}
          data-ui="ChildCalendarBlock.createEndButton"
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            try {
              const result = await addDateColumn(pageId, "end").catch(() => ({ error: failed }));
              if ("error" in result) await showAlert(result.error);
              else onChange({ endBy: result.id });
              await reload();
            } finally {
              setCreating(false);
            }
          }}
        >
          {t("childCalendar.createEnd")}
        </button>
      )}
    </div>
  );

  if (data === undefined || data === null || (!column && !builtin)) {
    return (
      <div className={styles.block} contentEditable={false} data-ui="ChildCalendarBlock">
        {header}
        {sourceId === "" ? (
          <LinkedUnsetNote />
        ) : data === undefined ? (
          <p className={styles.muted}>{t("loading")}</p>
        ) : data === null ? (
          <p className={styles.muted} data-ui="ChildCalendarBlock.status">
            {linked ? t("linkedView.cannotShow") : t("childCalendar.cannotShow")}
          </p>
        ) : (
          <div className={styles.empty}>
            <p className={styles.muted}>
              {t("childCalendar.noDateColumn")}
              {linked ? t("linkedView.columnsOnSource") : !data.canEditColumns && t("childCalendar.noDateColumnViewer")}
            </p>
            {editable && data.canEditColumns && !linked && (
              <button
                type="button"
                className={styles.primaryButton}
                data-ui="ChildCalendarBlock.createDateButton"
                disabled={creating}
                onClick={async () => {
                  setCreating(true);
                  try {
                    const result = await addDateColumn(pageId).catch(() => ({ error: failed }));
                    if ("error" in result) await showAlert(result.error);
                    else onChange({ dateBy: result.id });
                    await reload();
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                {t("childCalendar.startWithDate")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildCalendarBlock">
      {header}
      {layout === "calendar" && <MonthNav month={month} onMonth={setMonth} />}
      {filterCount > 0 && rows.length === 0 && data.rows.length > 0 && (
        <p className={styles.muted} data-ui="ChildCalendarBlock.noMatchStatus">
          {t("childTable.noMatch")}
        </p>
      )}
      {layout === "gantt" ? (
        <ChildGantt
          range={ganttRange}
          rows={rows}
          spanOf={spanOf}
          saving={saving}
          settable={settable}
          resizable={!!endColumn}
          canAdd={settable && (!linked || data.canEditColumns)}
          onChange={setSpan}
          onAdd={addPage}
        />
      ) : (
        <Grid
          month={month}
          byDay={byDay}
          undated={undated}
          data={data}
          saving={saving}
          settable={settable}
          // New pages go under the page whose child pages these are (for a
          // linked view, with EDIT there).
          canAdd={settable && (!linked || data.canEditColumns)}
          onMove={setDate}
          onAdd={addPage}
        />
      )}
    </div>
  );
}

function MonthNav({ month, onMonth }: { month: Month; onMonth: (m: Month) => void }) {
  const t = useTranslations("editor.childCalendar");
  const format = useFormatter();
  const label = format.dateTime(new Date(month.year, month.month - 1, 1), { year: "numeric", month: "long" });
  return (
    <div className={styles.nav}>
      <button type="button" className={styles.navButton} onClick={() => onMonth(addMonths(month, -1))} aria-label={t("previousMonth")} data-ui="ChildCalendarBlock.previousButton">
        ‹
      </button>
      <span className={styles.monthLabel} aria-live="polite" data-ui="ChildCalendarBlock.monthStatus">
        {label}
      </span>
      <button type="button" className={styles.navButton} onClick={() => onMonth(addMonths(month, 1))} aria-label={t("nextMonth")} data-ui="ChildCalendarBlock.nextButton">
        ›
      </button>
      <button type="button" className={styles.todayButton} onClick={() => onMonth(monthOf(todayKey())!)} data-ui="ChildCalendarBlock.todayButton">
        {t("today")}
      </button>
    </div>
  );
}

const UNDATED = "none";

function Grid({
  month,
  byDay,
  undated,
  data,
  saving,
  settable,
  canAdd,
  onMove,
  onAdd,
}: {
  month: Month;
  byDay: Map<string, ChildTableRow[]>;
  undated: ChildTableRow[];
  data: ChildTableData;
  saving: boolean;
  // Dates can be set (a date column, and the viewer can edit the page).
  settable: boolean;
  canAdd: boolean;
  onMove: (row: ChildTableRow, date: string) => Promise<void>;
  onAdd: (date: string, title: string) => Promise<void>;
}) {
  const t = useTranslations("editor.childCalendar");
  const locale = useLocale();
  const displayTitle = useDisplayTitle();
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const weeks = monthWeeks(month);
  const today = todayKey();
  const weekdays = useMemo(
    () => weeks[0].map((d) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${d.date}T12:00:00Z`))),
    // The weekdays are the same for every month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  // The latest rows and handler, for the listeners below.
  const live = useRef({ data, onMove });
  useEffect(() => {
    live.current = { data, onMove };
  });

  // Drag and drop with listeners on the calendar's own element, as the
  // board's (child-board-block.tsx): the editor would otherwise take a card
  // being dragged for its own selection being moved.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const dayOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>("[data-day]") ?? null;
    let dragged: string | null = null;
    const end = () => {
      dragged = null;
      setDragging(null);
      setOver(null);
    };
    const onDragStart = (e: DragEvent) => {
      e.stopPropagation();
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-card]");
      if (!card || card.draggable !== true || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      dragged = card.dataset.card ?? null;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-knowlective-card", dragged ?? "");
      setDragging(dragged);
    };
    const onDragOver = (e: DragEvent) => {
      e.stopPropagation();
      const day = dayOf(e.target);
      if (!dragged || !day) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setOver(day.dataset.day ?? null);
    };
    const onDrop = (e: DragEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const day = dayOf(e.target);
      const id = dragged;
      end();
      if (!id || !day) return;
      const row = live.current.data.rows.find((r) => r.id === id);
      const date = day.dataset.day === UNDATED ? "" : (day.dataset.day ?? "");
      if (row) void live.current.onMove(row, date);
    };
    const onDragEnd = (e: DragEvent) => {
      e.stopPropagation();
      end();
    };
    const stop = (e: DragEvent) => e.stopPropagation();
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragenter", stop);
    el.addEventListener("dragleave", stop);
    el.addEventListener("drop", onDrop);
    el.addEventListener("dragend", onDragEnd);
    return () => {
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragenter", stop);
      el.removeEventListener("dragleave", stop);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  const card = (row: ChildTableRow) => (
    <div
      key={row.id}
      role="listitem"
      className={dragging === row.id ? styles.cardDragging : styles.card}
      draggable={settable && row.canEdit}
      data-card={row.id}
      data-ui="ChildCalendarBlock.card"
      data-id={row.id}
    >
      <PageLink href={`/pages/${row.id}`} className={styles.cardLink} draggable={false} data-ui="ChildCalendarBlock.cardLink">
        {row.icon ? `${row.icon} ` : ""}
        {displayTitle(row.title)}
      </PageLink>
    </div>
  );

  return (
    <div ref={root} data-ui="ChildCalendarBlock.calendar" aria-busy={saving}>
      <div className={styles.grid} role="grid" aria-label={t("label")}>
        <div className={styles.weekRow} role="row">
          {weekdays.map((w, i) => (
            <div key={i} className={styles.weekday} role="columnheader" data-weekday={i}>
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].date} className={styles.weekRow} role="row">
            {week.map((day) => {
              const cards = byDay.get(day.date) ?? [];
              return (
                <div
                  key={day.date}
                  role="gridcell"
                  className={styles.day}
                  data-day={day.date}
                  data-out={!day.inMonth || undefined}
                  data-today={day.date === today || undefined}
                  data-over={(dragging && over === day.date) || undefined}
                  data-weekday={week.indexOf(day)}
                  data-ui="ChildCalendarBlock.day"
                  data-id={day.date}
                >
                  <div className={styles.dayHeader}>
                    <span className={styles.dayNumber}>{day.day}</span>
                    {canAdd && adding !== day.date && (
                      <button
                        type="button"
                        className={styles.addButton}
                        onClick={() => setAdding(day.date)}
                        aria-label={t("addOn", { date: day.date })}
                        data-ui="ChildCalendarBlock.addButton"
                        data-id={day.date}
                      >
                        ＋
                      </button>
                    )}
                  </div>
                  {/* Not ul / li: the editor styles those as its own lists. */}
                  <div className={styles.cards} role="list">
                    {cards.map(card)}
                  </div>
                  {adding === day.date && (
                    <CalendarAddInput
                      placeholder={t("newPagePlaceholder")}
                      onDone={async (text) => {
                        setAdding(null);
                        if (text !== null) await onAdd(day.date, text);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {(undated.length > 0 || dragging) && (
        <section
          className={styles.undated}
          data-day={UNDATED}
          data-over={(dragging && over === UNDATED) || undefined}
          data-ui="ChildCalendarBlock.undated"
          aria-label={t("undated")}
        >
          <header className={styles.undatedHeader}>
            {t("undated")} <span className={styles.count}>{undated.length}</span>
          </header>
          <div className={styles.undatedCards} role="list">
            {undated.map((row) => (
              <div key={row.id} className={styles.undatedItem}>
                {card(row)}
                {settable && row.canEdit && (
                  // The same as dragging it onto a day, without dragging.
                  <input
                    type="date"
                    // A 4-digit year: typing 20261116 goes on to the month (without a max, Chrome takes up to 6 digits).
                    max="9999-12-31"
                    className={styles.dateInput}
                    aria-label={t("setDate", { title: displayTitle(row.title) })}
                    onChange={(e) => e.target.value && void onMove(row, e.target.value)}
                    data-ui="ChildCalendarBlock.dateInput"
                    data-id={row.id}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
