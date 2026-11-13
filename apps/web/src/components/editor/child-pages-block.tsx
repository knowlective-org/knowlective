"use client";

import { PageLink } from "./page-link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { loadChildPages } from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { sortChildPages } from "@/lib/child-sort";
import type { ChildPageItem } from "@/lib/page-property-types";
import { BlockTitle } from "./block-title";
import { SortPicker } from "./child-sort";
import { usePersonalView } from "./child-table-block";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-blocks.module.css";
import { BLOCK_CONFIGS } from "./block-configs";

const DEPTHS = [1, 2, 3] as const;

// Child page list: links to the page's children, always current. Only the
// settings (title, how many levels, the order for everyone) are stored in the
// document; the list itself is fetched with the viewer's permissions. Each
// viewer can sort it their own way (child-sort.tsx), as the table.
export const childPagesBlock = createReactBlockSpec(
  BLOCK_CONFIGS.childPages,
  {
    render: ({ block, editor }) => (
      <ChildPagesList
        blockId={block.id}
        title={block.props.title}
        depth={block.props.depth}
        sort={block.props.sort}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
  },
);

function ChildPagesList({
  blockId,
  title,
  depth,
  sort,
  editable,
  onChange,
}: {
  blockId: string;
  title: string;
  depth: number;
  sort: string;
  editable: boolean;
  onChange: (props: { title?: string; depth?: number; sort?: string }) => void;
}) {
  const { pageId } = usePageEditor();
  const { data } = useChildrenData(loadChildPages);
  const { view, setView } = usePersonalView(pageId, blockId);
  const t = useTranslations("editor");
  const locale = useLocale();
  const displayTitle = useDisplayTitle();
  const pages = useMemo(
    () => (data ? sortChildPages(data, view.sort ?? sort, displayTitle, new Intl.Collator(locale).compare) : data),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayTitle follows the locale
    [data, view.sort, sort, locale],
  );

  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildPagesBlock">
      <div className={styles.header}>
        <BlockTitle
          value={title}
          placeholder={t("childPages.placeholder")}
          editable={editable}
          onSave={(next) => onChange({ title: next })}
          uiName="ChildPagesBlock"
        />
        {editable && (
          <select
            className={styles.inlineSelect}
            data-ui="ChildPagesBlock.depth"
            value={depth}
            onChange={(e) => onChange({ depth: Number(e.target.value) })}
            aria-label={t("childPages.levels")}
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {t("childPages.level", { count: d })}
              </option>
            ))}
          </select>
        )}
        {pages && pages.length > 1 && (
          <SortPicker
            uiName="ChildPagesBlock"
            keys={[
              { key: "title", label: t("childTable.title") },
              { key: "createdAt", label: t("childTable.builtin.createdAt") },
              { key: "updatedAt", label: t("childTable.builtin.updatedAt") },
            ]}
            blockSort={sort}
            personalSort={view.sort}
            editable={editable}
            onPersonal={(next) => setView({ ...view, sort: next })}
            onBlock={(next) => onChange({ sort: next })}
          />
        )}
      </div>
      {pages === undefined ? (
        <p className={styles.muted}>{t("loading")}</p>
      ) : pages === null || !pages.some((p) => p.parentId === pageId) ? (
        <p className={styles.muted}>{t("childPages.none")}</p>
      ) : (
        <PageList pages={pages} parentId={pageId} levels={depth} />
      )}
    </div>
  );
}

function PageList({ pages, parentId, levels }: { pages: ChildPageItem[]; parentId: string; levels: number }) {
  const children = pages.filter((p) => p.parentId === parentId);
  const t = useTranslations("editor.childPages");
  const format = useFormatter();
  const displayTitle = useDisplayTitle();
  if (children.length === 0) return null;
  return (
    <ul className={styles.pageList}>
      {children.map((p) => (
        <li key={p.id}>
          <PageLink href={`/pages/${p.id}`} className={styles.pageLink} data-ui="ChildPagesBlock.link" data-id={p.id}>
            <span aria-hidden>{p.icon ?? "📄"}</span>
            <span>{displayTitle(p.title)}</span>
          </PageLink>
          {p.updatedAt && (
            <time className={styles.pageMeta} dateTime={p.updatedAt} title={t("updatedAt")} data-ui="ChildPagesBlock.updatedAt">
              {format.dateTime(new Date(p.updatedAt), { dateStyle: "short", timeStyle: "short" })}
            </time>
          )}
          {levels > 1 && <PageList pages={pages} parentId={p.id} levels={levels - 1} />}
        </li>
      ))}
    </ul>
  );
}
