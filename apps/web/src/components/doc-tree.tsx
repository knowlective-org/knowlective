"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createChildPage } from "@/app/(app)/actions";
import { displayTitle } from "@/lib/page-title";
import styles from "./doc-tree.module.css";

export type DocTreeNode = {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  // The user can edit this page, so may add child pages under it.
  canEdit: boolean;
};

// The visible part of one knowledge root's page tree. It starts at the
// entry pages (the root page, and/or subtrees shared without their parent).
// Only the path to the current page starts expanded.
export function DocTree({
  nodes,
  entryIds,
  currentPageId,
  currentTitle,
  maxDepth,
}: {
  nodes: DocTreeNode[];
  entryIds: string[];
  // Null when no page is open (e.g. the empty home screen).
  currentPageId: string | null;
  // Live title of the open page, so renaming shows here before it's saved.
  currentTitle?: string;
  maxDepth: number;
}) {
  const { byId, childrenOf } = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const childrenOf = new Map<string, DocTreeNode[]>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n]);
    }
    return { byId, childrenOf };
  }, [nodes]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Only the path to the open page starts expanded (plus the page itself,
    // to show its children); trees not containing it start collapsed.
    const open = new Set<string>();
    if (!currentPageId || !byId.has(currentPageId)) return open;
    open.add(currentPageId);
    // Walk up from the current page; the depth cap also stops a corrupted cycle.
    let cursor = byId.get(currentPageId)?.parentId ?? null;
    for (let i = 0; cursor && i <= maxDepth; i++) {
      open.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return open;
  });

  const [creating, startCreating] = useTransition();
  const addChild = (parentId: string) =>
    startCreating(async () => {
      // On success the action redirects to the new page, which remounts the
      // tree with the path to it expanded.
      const result = await createChildPage(parentId);
      if (result?.error) alert(result.error);
    });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const entries = entryIds.map((id) => byId.get(id)).filter((n): n is DocTreeNode => !!n);
  if (entries.length === 0) return null;

  const renderNode = (node: DocTreeNode, depth: number, seen: Set<string>) => {
    const children = (childrenOf.get(node.id) ?? []).filter((c) => !seen.has(c.id));
    const isOpen = expanded.has(node.id);
    const isCurrent = node.id === currentPageId;
    const title = isCurrent && currentTitle !== undefined ? currentTitle : node.title;
    return (
      <li key={node.id} data-ui="DocTree.item" data-id={node.id}>
        <div className={isCurrent ? styles.rowCurrent : styles.row} style={{ paddingLeft: 4 + depth * 14 }}>
          {children.length > 0 ? (
            <button
              type="button"
              className={styles.toggle}
              data-ui="DocTree.toggle"
              aria-label={isOpen ? "折りたたむ" : "展開する"}
              aria-expanded={isOpen}
              onClick={() => toggle(node.id)}
            >
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className={styles.toggleSpacer} />
          )}
          <Link
            href={`/pages/${node.id}`}
            className={styles.link}
            data-ui="DocTree.link"
            data-id={node.id}
            aria-current={isCurrent ? "page" : undefined}
          >
            {node.icon ? `${node.icon} ` : ""}
            {displayTitle(title)}
          </Link>
          {node.canEdit && (
            <button
              type="button"
              className={styles.add}
              data-ui="DocTree.addChildButton"
              data-id={node.id}
              aria-label="子ページを追加"
              title="子ページを追加"
              disabled={creating}
              onClick={() => addChild(node.id)}
            >
              ＋
            </button>
          )}
        </div>
        {isOpen && children.length > 0 && depth < maxDepth && (
          <ul className={styles.list}>
            {children.map((c) => renderNode(c, depth + 1, new Set([...seen, c.id])))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="ドキュメントツリー" data-ui="DocTree">
      <ul className={styles.list}>{entries.map((e) => renderNode(e, 0, new Set([e.id])))}</ul>
    </nav>
  );
}
