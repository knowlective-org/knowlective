import { en, ja } from "@blocknote/core/locales";
import { locales as multiColumn } from "@blocknote/xl-multi-column";
import type { AppLocale } from "./locales";
import enEditor from "./messages/en/editor";
import jaEditor from "./messages/ja/editor";

// BlockNote's own text (menus, placeholders, toolbars) in the viewer's
// language, the columns' (xl-multi-column) included. Our blocks' text is in
// i18n/messages like everything else; the code block's tools, drawn outside
// React, read theirs from here (knowlective_code), as do the extended table's
// (knowlective_grid).
export function blockNoteDictionary(locale: AppLocale) {
  return locale === "en"
    ? { ...en, multi_column: multiColumn.en, knowlective_code: enEditor.editor.codeTools, knowlective_grid: enEditor.editor.gridTable }
    : { ...ja, multi_column: columnsJa, knowlective_code: jaEditor.editor.codeTools, knowlective_grid: jaEditor.editor.gridTable };
}

// xl-multi-column's own Japanese reads stiffly ("二列並んで") and isn't found
// by カラム / 段組み; ours instead.
const columnsJa = {
  slash_menu: {
    two_columns: {
      ...multiColumn.ja.slash_menu.two_columns,
      title: "2列レイアウト",
      subtext: "ブロックを2列に並べる",
      aliases: ["列", "カラム", "2列", "二列", "段組み", "レイアウト", "分割", "columns"],
    },
    three_columns: {
      ...multiColumn.ja.slash_menu.three_columns,
      title: "3列レイアウト",
      subtext: "ブロックを3列に並べる",
      aliases: ["列", "カラム", "3列", "三列", "段組み", "レイアウト", "分割", "columns"],
    },
  },
};
