"use client";

import Link from "next/link";
import { useState } from "react";
import { DocTree, type DocTreeNode } from "@/components/doc-tree";
import { EditorLoader } from "./editor-loader";
import styles from "./page-view.module.css";

// Two-pane page screen: the knowledge root's document tree on the left
// (sticky), the title + editor on the right. The open page's live title is
// shared so renaming shows in the tree immediately.
export function PageView({
  pageId,
  readOnly,
  user,
  tree,
  entryIds,
  maxDepth,
}: {
  pageId: string;
  readOnly: boolean;
  user: { id: string; name: string };
  tree: DocTreeNode[];
  // Where the visible tree starts (the root page, and/or shared subtrees).
  entryIds: string[];
  maxDepth: number;
}) {
  const [liveTitle, setLiveTitle] = useState<string | undefined>(undefined);

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.home}>
          ← ホーム
        </Link>
        <DocTree
          nodes={tree}
          entryIds={entryIds}
          currentPageId={pageId}
          currentTitle={liveTitle}
          maxDepth={maxDepth}
        />
      </aside>
      <main className={styles.main}>
        <EditorLoader pageId={pageId} readOnly={readOnly} user={user} onTitleChange={setLiveTitle} />
      </main>
    </div>
  );
}
