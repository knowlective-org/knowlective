"use client";

import { PageLink } from "./page-link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  addStatusColumn,
  loadChildTable,
  setCellValue,
  setColumnOptions,
} from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { createChildPageInPlace } from "@/app/(app)/actions";
import { showAlert } from "@/components/dialog";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { useReportSaving } from "@/lib/saving-status";
import {
  OPTION_COLORS,
  type ChildTableData,
  type ChildTableRow,
  type PropertyColumn,
  type SelectOption,
} from "@/lib/page-property-types";
import { BlockTitle } from "./block-title";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-board-block.module.css";
import { BLOCK_CONFIGS } from "./block-configs";

// Child page board (kanban): the page's child pages as cards, in one column per
// option of a select column — the same pages, columns and values as the
// child page table on the page, shown another way. Moving a card to another
// column sets that page's value. The block itself only stores how it's
// shown: its title and which column to group by.
//
// The order of the cards in a column is the child pages' own order (the one
// the sidebar shows).
//
// Sub-groups: a second column (select or user) can split the cards into one
// board per value, one under another, each with the same lanes. A card moves
// between lanes within its board, and to another board with its own picker
// (which sets that column's value).

// Cards whose page has no value for the grouping column.
const NO_VALUE = "";
const MAX_OPTION_NAME = 50;

export const childBoardBlock = createReactBlockSpec(
  BLOCK_CONFIGS.childBoard,
  {
    render: ({ block, editor }) => (
      <ChildBoard
        title={block.props.title}
        groupBy={block.props.groupBy}
        subGroupBy={block.props.subGroupBy}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
  },
);

// Runs a Server Action and shows its error (or a failure to reach it).
function useRun() {
  const failed = useTranslations("editor.save")("failed");
  return async (action: Promise<{ error?: string }>) => {
    const result = await action.catch(() => ({ error: failed }));
    if (result.error) await showAlert(result.error);
    return !result.error;
  };
}

// A sub-group's board: its value of the sub-group column ("" = none) and name.
type SubGroup = { value: string; name: string; color?: string };

function ChildBoard({
  title,
  groupBy,
  subGroupBy,
  editable,
  onChange,
}: {
  title: string;
  groupBy: string;
  subGroupBy: string;
  editable: boolean;
  onChange: (props: { title?: string; groupBy?: string; subGroupBy?: string }) => void;
}) {
  const { pageId } = usePageEditor();
  const router = useRouter();
  const { data, reload } = useChildrenData(loadChildTable);
  // Card moves shown before the server has confirmed them: "<page id>:<column
  // id>" → the new value.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [creatingColumn, setCreatingColumn] = useState(false);
  const t = useTranslations("editor");
  const run = useRun();

  // A move is shown at once and saved after: "saving" until the server has it.
  const saving = Object.keys(moved).length > 0;
  useReportSaving(saving);

  const selects = data?.columns.filter((c) => c.type === "SELECT") ?? [];
  const column = selects.find((c) => c.id === groupBy) ?? selects[0] ?? null;
  const subColumns = data?.columns.filter((c) => (c.type === "SELECT" || c.type === "USER") && c.id !== column?.id) ?? [];
  const subColumn = subColumns.find((c) => c.id === subGroupBy) ?? null;

  const header = (
    <div className={styles.header}>
      <BlockTitle
        value={title}
        placeholder={t("childBoard.placeholder")}
        editable={editable}
        onSave={(next) => onChange({ title: next })}
        uiName="ChildBoardBlock"
      />
      {editable && selects.length > 1 && column && (
        <select
          className={styles.inlineSelect}
          data-ui="ChildBoardBlock.groupBySelect"
          value={column.id}
          onChange={(e) => onChange({ groupBy: e.target.value })}
          aria-label={t("childBoard.groupBy")}
        >
          {selects.map((c) => (
            <option key={c.id} value={c.id}>
              {t("childBoard.groupByOption", { name: c.name })}
            </option>
          ))}
        </select>
      )}
      {editable && column && subColumns.length > 0 && (
        <select
          className={styles.inlineSelect}
          data-ui="ChildBoardBlock.subGroupBySelect"
          value={subColumn?.id ?? ""}
          onChange={(e) => onChange({ subGroupBy: e.target.value })}
          aria-label={t("childBoard.subGroupBy")}
        >
          <option value="">{t("childBoard.noSubGroup")}</option>
          {subColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {t("childBoard.subGroupByOption", { name: c.name })}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  if (data === undefined || data === null || !column) {
    return (
      <div className={styles.block} contentEditable={false} data-ui="ChildBoardBlock">
        {header}
        {data === undefined ? (
          <p className={styles.muted}>{t("loading")}</p>
        ) : data === null ? (
          <p className={styles.muted}>{t("childBoard.cannotShow")}</p>
        ) : (
          <div className={styles.empty}>
            <p className={styles.muted}>
              {t("childBoard.noSelectColumn")}
              {!data.canEditColumns && t("childBoard.noSelectColumnViewer")}
            </p>
            {editable && data.canEditColumns && (
              <button
                type="button"
                className={styles.primaryButton}
                data-ui="ChildBoardBlock.createStatusButton"
                disabled={creatingColumn}
                onClick={async () => {
                  setCreatingColumn(true);
                  try {
                    const result = await addStatusColumn(pageId).catch(() => ({ error: t("save.failed") }));
                    if ("error" in result) await showAlert(result.error);
                    else onChange({ groupBy: result.id });
                    await reload();
                  } finally {
                    setCreatingColumn(false);
                  }
                }}
              >
                {t("childBoard.startWithStatus")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // A value that is no longer one of a select column's options counts as none.
  const valueIn = (row: ChildTableRow, c: PropertyColumn) => {
    const value = moved[`${row.id}:${c.id}`] ?? row.values[c.id] ?? NO_VALUE;
    return c.type !== "SELECT" || c.options.some((o) => o.id === value) ? value : NO_VALUE;
  };
  const valueOf = (row: ChildTableRow) => valueIn(row, column);
  // Sets a card's values (column id → value): shown at once, saved after.
  const setValues = async (cardId: string, values: Record<string, string>) => {
    const keys = Object.keys(values).map((c) => `${cardId}:${c}`);
    setMoved((m) => ({ ...m, ...Object.fromEntries(Object.entries(values).map(([c, v]) => [`${cardId}:${c}`, v])) }));
    for (const [columnId, value] of Object.entries(values)) await run(setCellValue(cardId, columnId, value));
    await reload();
    setMoved((m) => Object.fromEntries(Object.entries(m).filter(([key]) => !keys.includes(key))));
  };
  const moveCard = async (row: ChildTableRow, optionId: string) => {
    if (!row.canEdit || valueOf(row) === optionId) return;
    await setValues(row.id, { [column.id]: optionId });
  };
  const moveToSubGroup = async (row: ChildTableRow, value: string) => {
    if (!row.canEdit || !subColumn || valueIn(row, subColumn) === value) return;
    await setValues(row.id, { [subColumn.id]: value });
  };
  const addCard = async (optionId: string, subValue: string, cardTitle: string) => {
    const result = await createChildPageInPlace(pageId, cardTitle).catch(() => ({ error: t("save.createFailed") }));
    if ("error" in result) {
      await showAlert(result.error);
      return false;
    }
    // Shown in its lane at once: the page exists before its values do, and
    // would otherwise flash in the "unset" lane.
    const values: Record<string, string> = {};
    if (optionId !== NO_VALUE) values[column.id] = optionId;
    if (subColumn && subValue !== NO_VALUE) values[subColumn.id] = subValue;
    await setValues(result.id, values);
    // The new page also belongs in the sidebar.
    router.refresh();
    return true;
  };
  const addOption = async (name: string) => {
    const option: SelectOption = {
      id: crypto.randomUUID(),
      name,
      color: OPTION_COLORS[column.options.length % OPTION_COLORS.length],
    };
    const ok = await run(setColumnOptions(column.id, [...column.options, option]));
    await reload();
    return ok;
  };

  const lanesOf = (rows: ChildTableRow[]) => {
    const lanes: { option: SelectOption | null; rows: ChildTableRow[] }[] = [
      { option: null, rows: rows.filter((r) => valueOf(r) === NO_VALUE) },
      ...column.options.map((option) => ({ option, rows: rows.filter((r) => valueOf(r) === option.id) })),
    ];
    // The lane without a value only shows while it has cards (or nothing else exists).
    return lanes.filter((lane) => lane.option !== null || lane.rows.length > 0 || column.options.length === 0);
  };
  const board = (rows: ChildTableRow[], sub: SubGroup | null) => (
    <Board
      lanes={lanesOf(rows)}
      column={column}
      saving={saving}
      // New pages go under this page, so adding a card needs EDIT on it.
      canAdd={editable}
      canAddLane={editable && data.canEditColumns}
      onMove={moveCard}
      onAddCard={(optionId, cardTitle) => addCard(optionId, sub?.value ?? NO_VALUE, cardTitle)}
      onAddLane={addOption}
      subGroup={subColumn && sub ? { column: subColumn, value: sub.value, name: sub.name, choices: subGroupsOf(subColumn, data) } : undefined}
      onMoveToSubGroup={moveToSubGroup}
    />
  );

  if (!subColumn) {
    return (
      <div className={styles.block} contentEditable={false} data-ui="ChildBoardBlock">
        {header}
        {board(data.rows, null)}
      </div>
    );
  }
  const groups = subGroupsOf(subColumn, data);
  const rowsIn = (value: string) => data.rows.filter((r) => valueIn(r, subColumn) === value);
  const shownGroups: SubGroup[] = [
    // "Not set" only while it has cards; the others always (to add cards to).
    ...groups.filter((g) => g.value !== NO_VALUE || rowsIn(NO_VALUE).length > 0),
    // People no longer among those who can be chosen, still in the cards.
    ...[...new Set(data.rows.map((r) => valueIn(r, subColumn)))]
      .filter((v) => v !== NO_VALUE && !groups.some((g) => g.value === v))
      .map((v) => ({ value: v, name: data.userNames[v] ?? t("childTable.unknownUser") })),
  ];
  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildBoardBlock">
      {header}
      {shownGroups.map((group) => {
        const rows = rowsIn(group.value);
        return (
          <details key={group.value || "none"} className={styles.subGroup} open data-ui="ChildBoardBlock.subGroup" data-id={group.value || "none"}>
            <summary className={styles.subGroupHeader}>
              <span className={styles.laneName} style={group.color ? { background: group.color } : undefined}>
                {group.name || t("childBoard.unset")}
              </span>
              <span className={styles.count} data-ui="ChildBoardBlock.subGroupCount">
                {rows.length}
              </span>
            </summary>
            {board(rows, group)}
          </details>
        );
      })}
    </div>
  );
}

// The sub-groups a column makes: "not set" first, then its options (a select
// column) or the people who can be chosen (a user column), by name.
function subGroupsOf(c: PropertyColumn, data: ChildTableData): SubGroup[] {
  const unset = { value: NO_VALUE, name: "" };
  if (c.type === "SELECT") return [unset, ...c.options.map((o) => ({ value: o.id, name: o.name, color: o.color }))];
  const people = [...data.assignees].sort((a, b) => a.name.localeCompare(b.name));
  return [unset, ...people.map((u) => ({ value: u.id, name: u.name }))];
}

function Board({
  lanes,
  column,
  saving,
  canAdd,
  canAddLane,
  onMove,
  onAddCard,
  onAddLane,
  subGroup,
  onMoveToSubGroup,
}: {
  lanes: { option: SelectOption | null; rows: ChildTableRow[] }[];
  column: PropertyColumn;
  saving: boolean;
  canAdd: boolean;
  canAddLane: boolean;
  onMove: (row: ChildTableRow, optionId: string) => Promise<void>;
  onAddCard: (optionId: string, title: string) => Promise<boolean>;
  onAddLane: (name: string) => Promise<boolean>;
  // The sub-group this board is (when the cards are split into several).
  subGroup?: { column: PropertyColumn; value: string; name: string; choices: SubGroup[] };
  onMoveToSubGroup: (row: ChildTableRow, value: string) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const t = useTranslations("editor.childBoard");
  const displayTitle = useDisplayTitle();
  // The latest rows and handler, for the listeners below.
  const live = useRef({ lanes, onMove });
  useEffect(() => {
    live.current = { lanes, onMove };
  });

  // Drag and drop with listeners on the board's own element, not React's: the
  // editor (ProseMirror) listens for the same events on an element above
  // this one and would treat a card being dragged as its own selection being
  // moved. Handling them here first, and stopping them, keeps it out.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const laneOf = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.closest<HTMLElement>("[data-lane]") ?? null;
    let dragged: string | null = null;

    const onDragStart = (e: DragEvent) => {
      e.stopPropagation();
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-card]");
      if (!card || card.draggable !== true || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      dragged = card.dataset.card ?? null;
      e.dataTransfer.effectAllowed = "move";
      // Needed for the drag to start in Firefox; the value isn't used.
      e.dataTransfer.setData("application/x-knowlective-card", dragged ?? "");
      setDragging(dragged);
    };
    const onDragOver = (e: DragEvent) => {
      e.stopPropagation();
      const lane = laneOf(e.target);
      if (!dragged || !lane) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setOver(lane.dataset.lane ?? null);
    };
    const onDrop = (e: DragEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const lane = laneOf(e.target);
      const id = dragged;
      end();
      if (!id || !lane) return;
      const row = live.current.lanes.flatMap((l) => l.rows).find((r) => r.id === id);
      if (row) void live.current.onMove(row, lane.dataset.lane ?? NO_VALUE);
    };
    const end = () => {
      dragged = null;
      setDragging(null);
      setOver(null);
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

  return (
    <div className={styles.board} ref={root} data-ui="ChildBoardBlock.board" aria-busy={saving}>
      {lanes.map(({ option, rows }) => {
        const laneId = option?.id ?? NO_VALUE;
        return (
          <section
            key={laneId || "none"}
            className={over === laneId && dragging ? styles.laneOver : styles.lane}
            data-lane={laneId}
            data-ui="ChildBoardBlock.lane"
            data-id={laneId || "none"}
            aria-label={option?.name ?? t("unset")}
          >
            <header className={styles.laneHeader}>
              <span className={styles.laneName} style={option ? { background: option.color } : undefined}>
                {option?.name ?? t("unset")}
              </span>
              <span className={styles.count} data-ui="ChildBoardBlock.laneCount">
                {rows.length}
              </span>
            </header>
            {/* Not ul / li: the editor styles those as its own lists. */}
            <div className={styles.cards} role="list">
              {rows.map((row) => (
                <div
                  key={row.id}
                  role="listitem"
                  className={dragging === row.id ? styles.cardDragging : styles.card}
                  draggable={row.canEdit}
                  data-card={row.id}
                  data-ui="ChildBoardBlock.card"
                  data-id={row.id}
                >
                  <PageLink href={`/pages/${row.id}`} className={styles.cardLink} draggable={false} data-ui="ChildBoardBlock.cardLink">
                    {row.icon ? `${row.icon} ` : ""}
                    {displayTitle(row.title)}
                  </PageLink>
                  {row.canEdit && (
                    // The same move without dragging (keyboard, touch).
                    <select
                      className={styles.cardSelect}
                      data-ui="ChildBoardBlock.cardLaneSelect"
                      value={laneId}
                      onChange={(e) => void onMove(row, e.target.value)}
                      aria-label={t("cardColumn", { title: displayTitle(row.title), column: column.name })}
                    >
                      <option value={NO_VALUE}>{t("unset")}</option>
                      {column.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {row.canEdit && subGroup && (
                    // Moves the card to another sub-group's board.
                    <select
                      className={styles.cardSelect}
                      data-ui="ChildBoardBlock.cardSubGroupSelect"
                      value={subGroup.value}
                      onChange={(e) => void onMoveToSubGroup(row, e.target.value)}
                      aria-label={t("cardSubGroup", { title: displayTitle(row.title), column: subGroup.column.name })}
                    >
                      {!subGroup.choices.some((c) => c.value === subGroup.value) && (
                        <option value={subGroup.value}>{subGroup.name}</option>
                      )}
                      {subGroup.choices.map((c) => (
                        <option key={c.value || "none"} value={c.value}>
                          {c.name || t("unset")}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
            {canAdd && <AddInline label={t("newPage")} placeholder={t("newPagePlaceholder")} uiName="addCard" onAdd={(title) => onAddCard(laneId, title)} />}
          </section>
        );
      })}
      {canAddLane && (
        <div className={styles.addLane}>
          <AddInline label={t("addLane")} placeholder={t("laneName")} uiName="addLane" required onAdd={onAddLane} />
        </div>
      )}
    </div>
  );
}

// A "+ …" button that turns into a one-line field: Enter adds, Esc (or
// leaving it empty) cancels.
function AddInline({
  label,
  placeholder,
  uiName,
  required = false,
  onAdd,
}: {
  label: string;
  placeholder: string;
  uiName: string;
  // An empty name isn't accepted (a page may be untitled; a column may not).
  required?: boolean;
  onAdd: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className={styles.addButton} data-ui={`ChildBoardBlock.${uiName}Button`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  const submit = async (value: string) => {
    const text = value.replace(/\s+/g, " ").trim();
    if (required && !text) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onAdd(text);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };
  return (
    <input
      className={styles.addInput}
      data-ui={`ChildBoardBlock.${uiName}Input`}
      placeholder={placeholder}
      maxLength={required ? MAX_OPTION_NAME : 200}
      autoFocus
      disabled={busy}
      aria-label={placeholder}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") void submit(e.currentTarget.value);
        if (e.key === "Escape") setOpen(false);
      }}
      onBlur={(e) => {
        // Leaving the field with something typed adds it; empty cancels.
        if (busy) return;
        if (e.currentTarget.value.trim()) void submit(e.currentTarget.value);
        else setOpen(false);
      }}
    />
  );
}
