"use client";

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
import type { Dictionary } from "@blocknote/core";
import { HEADING_LEVELS } from "./schema";

// The block types a text block can be turned into: BlockNote's list, without
// the heading levels the schema doesn't allow (the page title is the only H1;
// the default list still offers H1, which demoteH1 would only turn into H2).
export function textBlockTypes(dict: Dictionary): BlockTypeSelectItem[] {
  return blockTypeSelectItems(dict).filter(
    (item) =>
      item.type !== "heading" || (HEADING_LEVELS as readonly unknown[]).includes(item.props?.level),
  );
}

// The toolbar shown over selected text, with the filtered type list.
export function EditorFormattingToolbar() {
  return <FormattingToolbarController formattingToolbar={Toolbar} />;
}

function Toolbar() {
  const dict = useDictionary();
  return <FormattingToolbar blockTypeSelectItems={textBlockTypes(dict)} />;
}

// The ⋮⋮ handle's menu: BlockNote's items, plus changing the block's type.
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
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
    </DragHandleMenu>
  );
}

// Shown for text blocks only (a paragraph, heading, quote or list item);
// an image or a custom block has no text to carry over.
function BlockTypeItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const dict = useDictionary();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (block === undefined) return null;

  const items = textBlockTypes(dict);
  if (!items.some((item) => item.type === block.type)) return null;
  const isCurrent = (item: BlockTypeSelectItem) =>
    item.type === block.type &&
    Object.entries(item.props ?? {}).every(([name, value]) => block.props[name] === value);

  return (
    <Components.Generic.Menu.Root position="right" sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          種類を変更
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
                // Like "delete": the selected blocks when the handle's block
                // is one of them, otherwise that block alone.
                const selected = editor.getSelection()?.blocks;
                const targets = selected?.some((b) => b.id === block.id) ? selected : [block];
                editor.transact(() => {
                  for (const target of targets) {
                    if (!items.some((i) => i.type === target.type)) continue;
                    editor.updateBlock(target, { type: item.type, props: item.props });
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
