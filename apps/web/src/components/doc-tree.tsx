"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { displayTitle } from "@/lib/page-title";
import styles from "./doc-tree.module.css";

export type DocTreeNode = { id: string; title: string; icon: string | null; parentId: string | null };

// The page tree of one knowledge root, shown as its root page with nested
// children. Ancestors of the current page start expanded.
export function DocTree({
  nodes,
  rootPageId,
  currentPageId,
  currentTitle,
  maxDepth,
}: {
  nodes: DocTreeNode[];
  rootPageId: string;
  currentPageId: string;
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
    const open = new Set<string>([rootPageId]);
    // Walk up from the current page; the depth cap also stops a corrupted cycle.
    let cursor = byId.get(currentPageId)?.parentId ?? null;
    for (let i = 0; cursor && i <= maxDepth; i++) {
      open.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return open;
  });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const root = byId.get(rootPageId);
  if (!root) return null;

  const renderNode = (node: DocTreeNode, depth: number, seen: Set<string>) => {
    const children = (childrenOf.get(node.id) ?? []).filter((c) => !seen.has(c.id));
    const isOpen = expanded.has(node.id);
    const isCurrent = node.id === currentPageId;
    const title = isCurrent && currentTitle !== undefined ? currentTitle : node.title;
    return (
      <li key={node.id}>
        <div className={isCurrent ? styles.rowCurrent : styles.row} style={{ paddingLeft: 4 + depth * 14 }}>
          {children.length > 0 ? (
            <button
              type="button"
              className={styles.toggle}
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
            aria-current={isCurrent ? "page" : undefined}
          >
            {node.icon ? `${node.icon} ` : ""}
            {displayTitle(title)}
          </Link>
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
    <nav aria-label="ドキュメントツリー">
      <ul className={styles.list}>{renderNode(root, 0, new Set([root.id]))}</ul>
    </nav>
  );
}
