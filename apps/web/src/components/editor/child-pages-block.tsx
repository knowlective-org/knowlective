"use client";

import Link from "next/link";
import { createReactBlockSpec } from "@blocknote/react";
import { loadChildPages } from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { displayTitle } from "@/lib/page-title";
import type { ChildPageItem } from "@/lib/page-property-types";
import { BlockTitle } from "./block-title";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-blocks.module.css";

const DEPTHS = [1, 2, 3] as const;

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" });

const LIST_PLACEHOLDER = "子ページ一覧";

// Child page list: links to the page's children, always current. Only the
// settings (title, how many levels) are stored in the document; the list
// itself is fetched with the viewer's permissions.
export const childPagesBlock = createReactBlockSpec(
  {
    type: "childPages",
    propSchema: {
      // Shown above the list; empty shows the placeholder title.
      title: { default: "" },
      depth: { default: 1 },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <ChildPagesList
        title={block.props.title}
        depth={block.props.depth}
        editable={editor.isEditable}
        onChange={(props) => editor.updateBlock(block, { props })}
      />
    ),
  },
);

function ChildPagesList({
  title,
  depth,
  editable,
  onChange,
}: {
  title: string;
  depth: number;
  editable: boolean;
  onChange: (props: { title?: string; depth?: number }) => void;
}) {
  const { pageId } = usePageEditor();
  const { data } = useChildrenData(loadChildPages);

  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildPagesBlock">
      <div className={styles.header}>
        <BlockTitle
          value={title}
          placeholder={LIST_PLACEHOLDER}
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
            aria-label="表示する階層"
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d}階層
              </option>
            ))}
          </select>
        )}
      </div>
      {data === undefined ? (
        <p className={styles.muted}>読み込み中…</p>
      ) : data === null || !data.some((p) => p.parentId === pageId) ? (
        <p className={styles.muted}>子ページはありません。</p>
      ) : (
        <PageList pages={data} parentId={pageId} levels={depth} />
      )}
    </div>
  );
}

function PageList({ pages, parentId, levels }: { pages: ChildPageItem[]; parentId: string; levels: number }) {
  const children = pages.filter((p) => p.parentId === parentId);
  if (children.length === 0) return null;
  return (
    <ul className={styles.pageList}>
      {children.map((p) => (
        <li key={p.id}>
          <Link href={`/pages/${p.id}`} className={styles.pageLink} data-ui="ChildPagesBlock.link" data-id={p.id}>
            <span aria-hidden>{p.icon ?? "📄"}</span>
            <span>{displayTitle(p.title)}</span>
          </Link>
          {p.updatedAt && (
            <time className={styles.pageMeta} dateTime={p.updatedAt} title="最終更新日時" data-ui="ChildPagesBlock.updatedAt">
              {dateTimeFormat.format(new Date(p.updatedAt))}
            </time>
          )}
          {levels > 1 && <PageList pages={pages} parentId={p.id} levels={levels - 1} />}
        </li>
      ))}
    </ul>
  );
}
