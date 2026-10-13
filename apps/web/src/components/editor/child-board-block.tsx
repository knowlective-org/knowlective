"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { displayTitle } from "@/lib/page-title";
import { useReportSaving } from "@/lib/saving-status";
import { OPTION_COLORS, type ChildTableRow, type PropertyColumn, type SelectOption } from "@/lib/page-property-types";
import { BlockTitle } from "./block-title";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-board-block.module.css";

// 子ページボード (kanban): the page's child pages as cards, in one column per
// option of a 選択肢 column — the same pages, columns and values as the
// 子ページテーブル on the page, shown another way. Moving a card to another
// column sets that page's value. The block itself only stores how it's
// shown: its title and which column to group by.
//
// The order of the cards in a column is the child pages' own order (the one
// the sidebar shows).

const BOARD_PLACEHOLDER = "子ページボード";
// Cards whose page has no value for the grouping column.
const NO_VALUE = "";
const MAX_OPTION_NAME = 50;

export const childBoardBlock = createReactBlockSpec(
  {
    type: "childBoard",
    propSchema: {
      // Shown above the board; empty shows the placeholder 子ページボード.
      title: { default: "" },
      // Id of the 選択肢 column the cards are grouped by. Empty (or a column
      // that no longer exists) uses the page's first 選択肢 column.
      groupBy: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <ChildBoard
        title={block.props.title}
        groupBy={block.props.groupBy}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
  },
);

async function run(action: Promise<{ error?: string }>) {
  const result = await action.catch(() => ({ error: "保存に失敗しました。" }));
  if (result.error) await showAlert(result.error);
  return !result.error;
}

function ChildBoard({
  title,
  groupBy,
  editable,
  onChange,
}: {
  title: string;
  groupBy: string;
  editable: boolean;
  onChange: (props: { title?: string; groupBy?: string }) => void;
}) {
  const { pageId } = usePageEditor();
  const router = useRouter();
  const { data, reload } = useChildrenData(loadChildTable);
  // Card moves shown before the server has confirmed them: page id → option id.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [creatingColumn, setCreatingColumn] = useState(false);

  // A move is shown at once and saved after: 保存中 until the server has it.
  const saving = Object.keys(moved).length > 0;
  useReportSaving(saving);

  const selects = data?.columns.filter((c) => c.type === "SELECT") ?? [];
  const column = selects.find((c) => c.id === groupBy) ?? selects[0] ?? null;

  const header = (
    <div className={styles.header}>
      <BlockTitle
        value={title}
        placeholder={BOARD_PLACEHOLDER}
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
          aria-label="列に使う項目"
        >
          {selects.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}で分ける
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
          <p className={styles.muted}>読み込み中…</p>
        ) : data === null ? (
          <p className={styles.muted}>表示できません。</p>
        ) : (
          <div className={styles.empty}>
            <p className={styles.muted}>
              ボードの列にする「選択肢」の項目が、このページにまだありません。
              {!data.canEditColumns && " 編集できる人が作成すると、ここにボードが表示されます。"}
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
                    const result = await addStatusColumn(pageId).catch(() => ({ error: "保存に失敗しました。" }));
                    if ("error" in result) await showAlert(result.error);
                    else onChange({ groupBy: result.id });
                    await reload();
                  } finally {
                    setCreatingColumn(false);
                  }
                }}
              >
                「ステータス」を作ってボードを始める
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const optionIds = new Set(column.options.map((o) => o.id));
  // A value that is no longer one of the options counts as none.
  const valueOf = (row: ChildTableRow) => {
    const value = moved[row.id] ?? row.values[column.id] ?? NO_VALUE;
    return optionIds.has(value) ? value : NO_VALUE;
  };
  const moveCard = async (row: ChildTableRow, optionId: string) => {
    if (!row.canEdit || valueOf(row) === optionId) return;
    setMoved((m) => ({ ...m, [row.id]: optionId }));
    await run(setCellValue(row.id, column.id, optionId));
    await reload();
    setMoved((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== row.id)));
  };
  const addCard = async (optionId: string, cardTitle: string) => {
    const result = await createChildPageInPlace(pageId, cardTitle).catch(() => ({ error: "作成に失敗しました。" }));
    if ("error" in result) {
      await showAlert(result.error);
      return false;
    }
    if (optionId !== NO_VALUE) {
      // Shown in its lane at once: the page exists before its value does, and
      // would otherwise flash in 未設定.
      setMoved((m) => ({ ...m, [result.id]: optionId }));
      await run(setCellValue(result.id, column.id, optionId));
    }
    await reload();
    setMoved((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== result.id)));
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

  const lanes: { option: SelectOption | null; rows: ChildTableRow[] }[] = [
    { option: null, rows: data.rows.filter((r) => valueOf(r) === NO_VALUE) },
    ...column.options.map((option) => ({ option, rows: data.rows.filter((r) => valueOf(r) === option.id) })),
  ];
  // The lane without a value only shows while it has cards (or nothing else exists).
  const shown = lanes.filter((lane) => lane.option !== null || lane.rows.length > 0 || column.options.length === 0);

  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildBoardBlock">
      {header}
      <Board
        lanes={shown}
        column={column}
        saving={saving}
        // New pages go under this page, so adding a card needs EDIT on it.
        canAdd={editable}
        canAddLane={editable && data.canEditColumns}
        onMove={moveCard}
        onAddCard={addCard}
        onAddLane={addOption}
      />
    </div>
  );
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
}: {
  lanes: { option: SelectOption | null; rows: ChildTableRow[] }[];
  column: PropertyColumn;
  saving: boolean;
  canAdd: boolean;
  canAddLane: boolean;
  onMove: (row: ChildTableRow, optionId: string) => Promise<void>;
  onAddCard: (optionId: string, title: string) => Promise<boolean>;
  onAddLane: (name: string) => Promise<boolean>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
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
      e.dataTransfer.setData("application/x-yosuga-card", dragged ?? "");
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
            aria-label={option?.name ?? "未設定"}
          >
            <header className={styles.laneHeader}>
              <span className={styles.laneName} style={option ? { background: option.color } : undefined}>
                {option?.name ?? "未設定"}
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
                  <Link href={`/pages/${row.id}`} className={styles.cardLink} draggable={false} data-ui="ChildBoardBlock.cardLink">
                    {row.icon ? `${row.icon} ` : ""}
                    {displayTitle(row.title)}
                  </Link>
                  {row.canEdit && (
                    // The same move without dragging (keyboard, touch).
                    <select
                      className={styles.cardSelect}
                      data-ui="ChildBoardBlock.cardLaneSelect"
                      value={laneId}
                      onChange={(e) => void onMove(row, e.target.value)}
                      aria-label={`「${displayTitle(row.title)}」の${column.name}`}
                    >
                      <option value={NO_VALUE}>未設定</option>
                      {column.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
            {canAdd && <AddInline label="＋ 新しいページ" placeholder="ページのタイトル" uiName="addCard" onAdd={(title) => onAddCard(laneId, title)} />}
          </section>
        );
      })}
      {canAddLane && (
        <div className={styles.addLane}>
          <AddInline label="＋ 列を追加" placeholder="列の名前" uiName="addLane" required onAdd={onAddLane} />
        </div>
      )}
    </div>
  );
}

// A "＋ …" button that turns into a one-line field: Enter adds, Esc (or
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
