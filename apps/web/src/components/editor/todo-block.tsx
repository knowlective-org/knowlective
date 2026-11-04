"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createExtension, getBlockInfoFromSelection, updateBlockTr, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { loadTodoPeople, type TodoPeople } from "@/app/(app)/pages/[pageId]/todo-actions";
import { usePageEditor } from "./page-context";
import styles from "./todo-block.module.css";
import { BLOCK_CONFIGS } from "./block-configs";

// TODO block: a to-do item with an assignee, a due date (shown as overdue
// once it's past and the item isn't done) and, once ticked, who ticked it
// and when. It takes the place of BlockNote's check list in the menus; check
// list blocks already in pages stay as they are (and can be turned into
// TODOs from the ⋮⋮ menu).

// Enter in a list-like block: a new one of the same type below (with the
// text after the cursor), or, in an empty one, back to a paragraph. Like
// BlockNote's own for its lists; also used for the check lists left in pages.
export function continueList(editor: Pick<BlockNoteEditor, "transact">, type: string): boolean {
  return editor.transact((tr) => {
    const info = getBlockInfoFromSelection(tr);
    if (!info.isBlockContainer || info.blockContent.node.type.name !== type || !tr.selection.empty) return false;
    if (info.blockContent.node.childCount === 0) {
      updateBlockTr(tr, info.bnBlock.beforePos, { type: "paragraph", props: {} });
      return true;
    }
    // The new item starts unticked, with no assignee or date.
    tr.split(tr.selection.from, 2, [
      { type: info.bnBlock.node.type, attrs: {} },
      { type: info.blockContent.node.type, attrs: {} },
    ]);
    tr.scrollIntoView();
    return true;
  });
}

// "[ ] " / "[x] " at the start of a line, and Ctrl/Cmd+Shift+9, make a TODO
// (they made a check list before).
export const todoShortcuts = createExtension({
  key: "knowlective-todo",
  keyboardShortcuts: {
    Enter: ({ editor }) => continueList(editor, "todo"),
    "Mod-Shift-9": ({ editor }) => {
      const { block } = editor.getTextCursorPosition();
      if (editor.schema.blockSchema[block.type].content !== "inline") return false;
      editor.updateBlock(block, { type: "todo", props: {} } as never);
      return true;
    },
  },
  inputRules: [
    { find: /^\s?\[\s*\]\s$/, replace: () => ({ type: "todo", props: { checked: false } }) as never },
    { find: /^\s?\[[Xx]\]\s$/, replace: () => ({ type: "todo", props: { checked: true } }) as never },
  ],
});

export const todoBlock = createReactBlockSpec(
  BLOCK_CONFIGS.todo,
  {
    render: ({ block, editor, contentRef }) => (
      <Todo
        props={block.props}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
        contentRef={contentRef}
      />
    ),
  },
  [todoShortcuts],
);

type TodoProps = { checked: boolean; assignee: string; due: string; doneBy: string; doneAt: string };

// The page's people, loaded once for all the TODOs on it (and again after a
// minute, for those given access since).
const peopleCache = new Map<string, Promise<TodoPeople | null>>();

function useTodoPeople(pageId: string): TodoPeople | null {
  const [people, setPeople] = useState<TodoPeople | null>(null);
  useEffect(() => {
    let alive = true;
    let load = peopleCache.get(pageId);
    if (!load) {
      load = loadTodoPeople(pageId).catch(() => null);
      peopleCache.set(pageId, load);
      setTimeout(() => peopleCache.delete(pageId), 60_000);
    }
    void load.then((result) => {
      if (alive) setPeople(result);
    });
    return () => {
      alive = false;
    };
  }, [pageId]);
  return people;
}

// Today in the viewer's time zone, as YYYY-MM-DD.
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Todo({
  props,
  editable,
  onChange,
  contentRef,
}: {
  props: TodoProps;
  editable: boolean;
  onChange: (props: Partial<TodoProps>) => void;
  contentRef: (node: HTMLElement | null) => void;
}) {
  const t = useTranslations("editor.todo");
  const format = useFormatter();
  const { pageId, userId } = usePageEditor();
  // null for someone not logged in: no names.
  const people = useTodoPeople(pageId);
  const { checked, assignee, due, doneBy, doneAt } = props;
  const nameOf = (id: string) => (people ? (people.find((p) => p.id === id)?.name ?? t("unknownUser")) : null);
  const overdue = !checked && due !== "" && due < today();
  const dueText = due ? format.dateTime(new Date(`${due}T00:00:00`), { dateStyle: "medium" }) : "";
  const assigneeName = assignee ? nameOf(assignee) : null;
  const doneName = doneBy ? nameOf(doneBy) : null;
  const doneDate = doneAt ? format.dateTime(new Date(doneAt), { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <div className={styles.todo} data-checked={checked} data-ui="TodoBlock">
      <input
        type="checkbox"
        className={styles.checkbox}
        contentEditable={false}
        checked={checked}
        disabled={!editable}
        aria-label={t("done")}
        data-ui="TodoBlock.checkbox"
        onChange={(e) =>
          onChange(
            e.target.checked
              ? { checked: true, doneBy: userId ?? "", doneAt: new Date().toISOString() }
              : { checked: false, doneBy: "", doneAt: "" },
          )
        }
      />
      <div className={styles.text} ref={contentRef} />
      <div className={styles.meta} contentEditable={false}>
        {editable ? (
          <select
            className={`${styles.control} ${assignee ? "" : styles.empty}`}
            value={assignee}
            aria-label={t("assignee")}
            title={t("assignee")}
            data-ui="TodoBlock.assigneeSelect"
            onChange={(e) => onChange({ assignee: e.target.value })}
          >
            <option value="">{t("noAssignee")}</option>
            {assignee && !people?.some((p) => p.id === assignee) && <option value={assignee}>{assigneeName ?? "…"}</option>}
            {people?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          assigneeName && (
            <span className={styles.chip} data-ui="TodoBlock.assignee">
              {t("assignedTo", { name: assigneeName })}
            </span>
          )
        )}
        {editable ? (
          <input
            type="date"
            className={`${styles.control} ${due ? "" : styles.empty} ${overdue ? styles.overdue : ""}`}
            value={due}
            aria-label={t("due")}
            title={t("due")}
            data-ui="TodoBlock.dueInput"
            onChange={(e) => onChange({ due: e.target.value })}
          />
        ) : (
          due && (
            <span className={`${styles.chip} ${overdue ? styles.overdue : ""}`} data-ui="TodoBlock.due">
              {t("dueOn", { date: dueText })}
            </span>
          )
        )}
        {overdue && (
          <span className={styles.overdueMark} role="status" data-ui="TodoBlock.overdueStatus">
            {t("overdue")}
          </span>
        )}
        {checked && doneDate && (
          <span className={styles.done} data-ui="TodoBlock.doneStatus">
            {doneName ? t("doneBy", { name: doneName, date: doneDate }) : t("doneAt", { date: doneDate })}
          </span>
        )}
      </div>
    </div>
  );
}
