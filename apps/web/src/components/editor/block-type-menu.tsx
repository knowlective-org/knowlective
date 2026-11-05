"use client";

import { useTranslations } from "next-intl";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  BlockColorsItem,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  blockTypeSelectItems,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtensionState,
  type BlockTypeSelectItem,
  type SideMenuProps,
} from "@blocknote/react";
import { getNodeById, type Dictionary } from "@blocknote/core";
import { showNotice } from "../notice";
import { showConfirm } from "../dialog";
import { blockLockOf, setBlockLocks } from "./block-lock";
import type { BlockLock } from "@/lib/block-locks";
import { HEADING_LEVELS, editorSchema, type KnowlectiveEditor } from "./schema";

// The block types a text block can be turned into: BlockNote's list, without
// the heading levels the schema doesn't allow (the page title is the only H1;
// the default list still offers H1, which demoteH1 would only turn into H2).
// The check list is offered as a TODO (todo-block.tsx), under `todoName`.
export function textBlockTypes(dict: Dictionary, todoName: string): BlockTypeSelectItem[] {
  return blockTypeSelectItems(dict)
    .filter((item) => item.type !== "heading" || (HEADING_LEVELS as readonly unknown[]).includes(item.props?.level))
    .map((item) => (item.type === "checkListItem" ? { ...item, name: todoName, type: "todo", props: {} } : item));
}

// Check lists already in pages can be turned into something else (a TODO).
const convertible = (items: BlockTypeSelectItem[], type: string) =>
  type === "checkListItem" || items.some((item) => item.type === type);

// The toolbar shown over selected text, with the filtered type list.
export function EditorFormattingToolbar() {
  return <FormattingToolbarController formattingToolbar={Toolbar} />;
}

function Toolbar() {
  const dict = useDictionary();
  const t = useTranslations("editor.slash");
  return <FormattingToolbar blockTypeSelectItems={textBlockTypes(dict, t("todo"))} />;
}

// The ⋮⋮ handle's menu: BlockNote's items, plus changing the block's type,
// copying the blocks to the clipboard, duplicating and locking them.
export function EditorSideMenu() {
  return <SideMenuController sideMenu={BlockSideMenu} />;
}

function BlockSideMenu(props: SideMenuProps) {
  return <SideMenu {...props} dragHandleMenu={BlockMenu} />;
}

function BlockMenu() {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <BlockTypeItem />
      <CopyBlockItem />
      <DuplicateBlockItem />
      <LockItem />
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
    </DragHandleMenu>
  );
}

type MenuBlock = NonNullable<ReturnType<KnowlectiveEditor["getBlock"]>>;

// Like "delete": the selected blocks when the handle's block is one of them,
// otherwise that block alone.
function targetBlocks(editor: KnowlectiveEditor, block: MenuBlock): MenuBlock[] {
  const selected = editor.getSelection()?.blocks;
  return selected?.some((b) => b.id === block.id) ? selected : [block];
}

function useMenuBlock() {
  const editor = useBlockNoteEditor(editorSchema);
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  return { editor, block };
}

// Copies the blocks the way Ctrl+C does: BlockNote's own format (so a paste
// into a page brings them back as they were, custom blocks and heading levels
// included), HTML and Markdown for other apps. Written from a copy event, which
// unlike the Clipboard API can carry BlockNote's format.
function copyBlocks(editor: KnowlectiveEditor, blocks: MenuBlock[]): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;
  const doc = view.state.doc;
  const first = getNodeById(blocks[0].id, doc);
  const last = getNodeById(blocks[blocks.length - 1].id, doc);
  if (!first || !last) return false;
  // The selected blocks are siblings; otherwise only the first one is copied.
  const sameParent = doc.resolve(first.posBeforeNode).parent === doc.resolve(last.posBeforeNode).parent;
  const end = sameParent ? last.posBeforeNode + last.node.nodeSize : first.posBeforeNode + first.node.nodeSize;
  const copied = sameParent ? blocks : blocks.slice(0, 1);
  const internal = view.serializeForClipboard(doc.slice(first.posBeforeNode, end)).dom.innerHTML;
  const html = editor.blocksToHTMLLossy(copied);
  const markdown = editor.blocksToMarkdownLossy(copied);
  let written = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.clipboardData.setData("blocknote/html", internal);
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData("text/plain", markdown);
    written = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
  return written;
}

function CopyBlockItem() {
  const Components = useComponentsContext()!;
  const { editor, block } = useMenuBlock();
  const t = useTranslations("editor.blockMenu");
  if (block === undefined) return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      data-ui="BlockMenu.copyItem"
      onClick={() => showNotice(copyBlocks(editor, targetBlocks(editor, block)) ? t("copied") : t("copyFailed"))}
    >
      {t("copy")}
    </Components.Generic.Menu.Item>
  );
}

// The copy goes right after the last of the blocks, with new ids (a chat's
// messages, kept by block id, stay with the original).
function DuplicateBlockItem() {
  const Components = useComponentsContext()!;
  const { editor, block } = useMenuBlock();
  const t = useTranslations("editor.blockMenu");
  if (block === undefined || !editor.isEditable) return null;
  type Copy = Omit<MenuBlock, "id" | "children"> & { children: Copy[] };
  const withoutIds = ({ id: _id, children, ...rest }: MenuBlock): Copy => ({ ...rest, children: children.map(withoutIds) });
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      data-ui="BlockMenu.duplicateItem"
      onClick={() => {
        const targets = targetBlocks(editor, block);
        const inserted = editor.insertBlocks(targets.map(withoutIds) as never, targets[targets.length - 1], "after");
        if (inserted[0]) editor.setTextCursorPosition(inserted[0], "end");
        editor.focus();
      }}
    >
      {t("duplicate")}
    </Components.Generic.Menu.Item>
  );
}

// none < "delete" < "edit" (block-lock.ts).
const LOCK_RANK = { none: 0, delete: 1, edit: 2 } as const;
type LockChoice = keyof typeof LOCK_RANK;

// Locks the blocks (block-lock.ts) for editors: against deleting, or also
// against changing their content. Loosening a lock asks first.
function LockItem() {
  const Components = useComponentsContext()!;
  const { editor, block } = useMenuBlock();
  const t = useTranslations("editor.blockMenu");
  if (block === undefined || !editor.isEditable) return null;
  const targets = targetBlocks(editor, block);
  const current: LockChoice[] = targets.map((b) => blockLockOf(editor, b.id) ?? "none");
  const choices: { value: LockChoice; label: string; ui: string }[] = [
    { value: "none", label: t("lockNone"), ui: "BlockMenu.lockNoneItem" },
    { value: "delete", label: t("lockDelete"), ui: "BlockMenu.lockDeleteItem" },
    { value: "edit", label: t("lockEdit"), ui: "BlockMenu.lockEditItem" },
  ];
  const choose = async (value: LockChoice) => {
    const loosened = targets.filter((_, i) => LOCK_RANK[current[i]] > LOCK_RANK[value]);
    if (
      loosened.length > 0 &&
      !(await showConfirm(t("loosenConfirm", { count: loosened.length, level: value }), {
        title: t("loosenTitle"),
        confirmLabel: t("loosen"),
        danger: true,
      }))
    ) {
      return;
    }
    setBlockLocks(
      editor,
      targets.map((b) => b.id),
      value === "none" ? null : (value as BlockLock),
    );
  };
  return (
    <Components.Generic.Menu.Root position="right" sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger data-ui="BlockMenu.lockItem">
          {t("lock")}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {choices.map((choice) => (
          <Components.Generic.Menu.Item
            key={choice.value}
            className="bn-menu-item"
            data-ui={choice.ui}
            checked={current.every((c) => c === choice.value)}
            onClick={() => void choose(choice.value)}
          >
            {choice.label}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

// Shown for text blocks only (a paragraph, heading, quote or list item);
// an image or a custom block has no text to carry over.
function BlockTypeItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor(editorSchema);
  const dict = useDictionary();
  const t = useTranslations("editor.blockType");
  const slash = useTranslations("editor.slash");
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block === undefined) return null;

  const items = textBlockTypes(dict, slash("todo"));
  if (!convertible(items, block.type)) return null;
  const isCurrent = (item: BlockTypeSelectItem) =>
    item.type === block.type &&
    Object.entries(item.props ?? {}).every(([name, value]) => block.props[name] === value);

  return (
    <Components.Generic.Menu.Root position="right" sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          {t("change")}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Components.Generic.Menu.Item
              key={item.name}
              className="bn-menu-item"
              icon={<Icon size={16} />}
              checked={isCurrent(item)}
              onClick={() => {
                const targets = targetBlocks(editor, block);
                editor.transact(() => {
                  for (const target of targets) {
                    if (!convertible(items, target.type)) continue;
                    // The items are this schema's types (textBlockTypes()).
                    editor.updateBlock(target, { type: item.type, props: item.props } as never);
                  }
                });
                editor.focus();
              }}
            >
              {item.name}
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}
