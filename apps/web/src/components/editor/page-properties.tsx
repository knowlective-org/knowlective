"use client";

import { useTranslations } from "next-intl";
import { loadPageProperties, setCellValue } from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { showAlert } from "@/components/dialog";
import { beginSaving } from "@/lib/saving-status";
import type { PageProperties as Data } from "@/lib/page-property-types";
import { Cell } from "./child-table-block";
import { MaskProvider } from "./masked-cell";
import { useChildrenData } from "./page-context";
import styles from "./page-properties.module.css";

// Under the title of a page in its parent's child page table: the page's
// values in the table's columns, changed here as in the table (EDIT on this
// page, not locked). Nothing when the parent has no columns, or the viewer
// can't open the parent.
export function PageProperties() {
  const t = useTranslations("editor");
  const { data, reload } = useChildrenData<Data>(loadPageProperties);
  if (!data) return null;
  const maskValues = (columnId: string) => [data.row.values[columnId] ?? ""];
  const save = async (defId: string, value: string) => {
    const done = beginSaving();
    try {
      const result = await setCellValue(data.row.id, defId, value).catch(() => ({ error: t("save.failed") }));
      if (result.error) await showAlert(result.error);
      await reload();
    } finally {
      done();
    }
  };
  return (
    <MaskProvider values={maskValues} inlineHide>
      <div className={styles.properties} role="group" aria-label={t("properties.label")} data-ui="PageProperties">
        {data.columns.map((column) => (
          <div key={column.id} className={styles.row} data-ui="PageProperties.row" data-id={column.id}>
            <div className={styles.name}>{column.name}</div>
            <div className={styles.value}>
              <Cell
                column={column}
                value={data.row.values[column.id] ?? ""}
                editable={data.row.canEdit}
                data={data}
                onSave={(value) => void save(column.id, value)}
              />
            </div>
          </div>
        ))}
      </div>
    </MaskProvider>
  );
}
