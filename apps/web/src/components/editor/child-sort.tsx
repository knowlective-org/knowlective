"use client";

import { useTranslations } from "next-intl";
import styles from "./child-blocks.module.css";

// The sort picker of the child page list and board. As the child page
// table's sort: what someone picks is their own (saved on their account with
// their filters: usePersonalView), over the block's own order (its `sort`
// prop, "<key>:asc" / "<key>:desc", "" = the pages' own order), which those
// who can edit the page can set from theirs.

export type SortKey = { key: string; label: string };

export function SortPicker({
  uiName,
  keys,
  blockSort,
  personalSort,
  editable,
  onPersonal,
  onBlock,
}: {
  // The block's data-ui name (ChildPagesBlock → ChildPagesBlock.sortSelect).
  uiName: string;
  keys: SortKey[];
  blockSort: string;
  // The viewer's own sort; null: the block's.
  personalSort: string | null;
  editable: boolean;
  onPersonal: (sort: string | null) => void;
  onBlock: (sort: string) => void;
}) {
  const t = useTranslations("editor.childSort");
  const current = personalSort ?? blockSort;
  const known = keys.some((k) => current === `${k.key}:asc` || current === `${k.key}:desc`);
  return (
    <>
      <select
        className={styles.inlineSelect}
        data-ui={`${uiName}.sortSelect`}
        aria-label={t("label")}
        value={known ? current : ""}
        onChange={(e) => onPersonal(e.target.value === blockSort ? null : e.target.value)}
      >
        <option value="">{t("pageOrder")}</option>
        {keys.flatMap((k) =>
          (["asc", "desc"] as const).map((dir) => (
            <option key={`${k.key}:${dir}`} value={`${k.key}:${dir}`}>
              {t("option", { name: k.label, dir })}
            </option>
          )),
        )}
      </select>
      {personalSort !== null && personalSort !== blockSort && (
        <>
          {editable && (
            <button
              type="button"
              className={styles.toolButton}
              data-ui={`${uiName}.setDefaultSortButton`}
              onClick={() => {
                onBlock(personalSort);
                onPersonal(null);
              }}
            >
              {t("makeDefault")}
            </button>
          )}
          <button type="button" className={styles.toolButton} data-ui={`${uiName}.resetSortButton`} onClick={() => onPersonal(null)}>
            {t("reset")}
          </button>
        </>
      )}
    </>
  );
}
