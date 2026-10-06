"use client";

import Link from "next/link";
import { createReactBlockSpec } from "@blocknote/react";
import { loadChildPages } from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { displayTitle } from "@/lib/page-title";
import type { ChildPageItem } from "@/lib/page-property-types";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./child-blocks.module.css";

const DEPTHS = [1, 2, 3] as const;

// 子ページ一覧: links to the page's children, always current. Only the
// settings (how many levels) are stored in the document; the list itself is
// fetched with the viewer's permissions.
export const childPagesBlock = createReactBlockSpec(
  {
    type: "childPages",
    propSchema: { depth: { default: 1 } },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <ChildPagesList
        depth={block.props.depth}
        onDepthChange={
          editor.isEditable ? (depth) => editor.updateBlock(block, { props: { depth } }) : undefined
        }
      />
    ),
  },
);

function ChildPagesList({ depth, onDepthChange }: { depth: number; onDepthChange?: (depth: number) => void }) {
  const { pageId } = usePageEditor();
  const { data } = useChildrenData(loadChildPages);

  return (
    <div className={styles.block} contentEditable={false} data-ui="ChildPagesBlock">
      <div className={styles.header}>
        <span className={styles.label}>子ページ一覧</span>
        {onDepthChange && (
          <select
            className={styles.inlineSelect}
            data-ui="ChildPagesBlock.depth"
            value={depth}
            onChange={(e) => onDepthChange(Number(e.target.value))}
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
          {levels > 1 && <PageList pages={pages} parentId={p.id} levels={levels - 1} />}
        </li>
      ))}
    </ul>
  );
}
