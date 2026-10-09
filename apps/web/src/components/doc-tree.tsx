"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DragEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createChildPage } from "@/app/(app)/actions";
import { displayTitle } from "@/lib/page-title";
import { showAlert } from "./dialog";
import { confirmAndMovePage, getDraggedPage, setDraggedPage } from "./move-page";
import styles from "./doc-tree.module.css";

type DropZone = "before" | "after" | "into";
type MoveTarget = { parentId: string; beforeId: string | null };

const DRAG_TYPE = "application/x-yosuga-page";
// Hovering a collapsed page this long while dragging expands it.
const EXPAND_DELAY_MS = 600;

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
//
// Pages can be dragged: onto the upper/lower edge of a row to go before/after
// it, onto the middle to become its last child. The server checks every move
// (lib/page-move.ts); a change of parent is confirmed first.
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

  const router = useRouter();
  const [moving, startMoving] = useTransition();
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const expandTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancelExpand = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  useEffect(() => () => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
  }, []);

  const canDrag = (node: DocTreeNode) =>
    !moving && node.parentId !== null && (node.canEdit || !!byId.get(node.parentId)?.canEdit);

  const subtreeOf = (id: string) => {
    const result = new Set<string>();
    const walk = (nodeId: string, depth: number) => {
      if (result.has(nodeId) || depth > maxDepth) return;
      result.add(nodeId);
      for (const c of childrenOf.get(nodeId) ?? []) walk(c.id, depth + 1);
    };
    walk(id, 0);
    return result;
  };

  // Where dropping on `node` in `zone` would put the dragged page, or null
  // if the user can't (a before/after that isn't allowed falls back to into).
  const targetFor = (node: DocTreeNode, zone: DropZone): { zone: DropZone; target: MoveTarget } | null => {
    const d = getDraggedPage();
    if (!d || d.subtree.has(node.id)) return null;
    const into = (): { zone: DropZone; target: MoveTarget } | null => {
      if (!node.canEdit || (node.id !== d.parentId && !d.canEdit)) return null;
      return { zone: "into", target: { parentId: node.id, beforeId: null } };
    };
    if (zone === "into") return into();
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // Entry pages have no visible siblings to be ordered among.
    if (!parent || entryIds.includes(node.id) || !parent.canEdit || (parent.id !== d.parentId && !d.canEdit)) {
      return into();
    }
    const siblings = (childrenOf.get(parent.id) ?? []).filter((c) => c.id !== d.id);
    const beforeId = zone === "before" ? node.id : (siblings[siblings.indexOf(node) + 1]?.id ?? null);
    return { zone, target: { parentId: parent.id, beforeId } };
  };

  // Dropping a page right where it already is.
  const isNoop = (target: MoveTarget) => {
    const d = getDraggedPage();
    if (!d || target.parentId !== d.parentId) return false;
    const siblings = childrenOf.get(d.parentId) ?? [];
    const next = siblings[siblings.findIndex((c) => c.id === d.id) + 1]?.id ?? null;
    return target.beforeId === next;
  };

  const zoneAt = (e: DragEvent<HTMLElement>): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    return y < 0.25 ? "before" : y > 0.75 ? "after" : "into";
  };

  const onDragStart = (e: DragEvent<HTMLElement>, node: DocTreeNode, title: string) => {
    setDraggedPage({ id: node.id, title, parentId: node.parentId!, canEdit: node.canEdit, subtree: subtreeOf(node.id) });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_TYPE, node.id);
    setDraggingId(node.id);
  };

  const onDragEnd = () => {
    setDraggedPage(null);
    setDraggingId(null);
    setDrop(null);
    cancelExpand();
  };

  const onDragOver = (e: DragEvent<HTMLElement>, node: DocTreeNode, hasChildren: boolean) => {
    if (!getDraggedPage() || moving) return;
    const result = targetFor(node, zoneAt(e));
    if (!result) {
      if (drop?.id === node.id) setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (drop?.id !== node.id || drop.zone !== result.zone) setDrop({ id: node.id, zone: result.zone });
    if (result.zone === "into" && hasChildren && !expanded.has(node.id)) {
      if (expandTimer.current?.id !== node.id) {
        cancelExpand();
        expandTimer.current = {
          id: node.id,
          timer: setTimeout(() => setExpanded((prev) => new Set(prev).add(node.id)), EXPAND_DELAY_MS),
        };
      }
    } else if (expandTimer.current?.id === node.id) {
      cancelExpand();
    }
  };

  const onDragLeave = (e: DragEvent<HTMLElement>, node: DocTreeNode) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (drop?.id === node.id) setDrop(null);
    if (expandTimer.current?.id === node.id) cancelExpand();
  };

  const onDrop = (e: DragEvent<HTMLElement>, node: DocTreeNode) => {
    e.preventDefault();
    const d = getDraggedPage();
    const result = targetFor(node, zoneAt(e));
    onDragEnd();
    if (!d || !result || isNoop(result.target)) return;
    const { parentId, beforeId } = result.target;
    startMoving(async () => {
      const moved = await confirmAndMovePage({ pageId: d.id, title: d.title, parentId, beforeId });
      if (!moved) return;
      setExpanded((prev) => new Set(prev).add(parentId));
      router.refresh();
    });
  };

  const [creating, startCreating] = useTransition();
  const addChild = (parentId: string) =>
    startCreating(async () => {
      // On success the action redirects to the new page, which remounts the
      // tree with the path to it expanded.
      const result = await createChildPage(parentId);
      if (result?.error) await showAlert(result.error, { title: "ページを作成できません" });
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
    const dropZone = drop?.id === node.id ? drop.zone : null;
    const rowClass = [
      isCurrent ? styles.rowCurrent : styles.row,
      dropZone === "before" && styles.dropBefore,
      dropZone === "after" && styles.dropAfter,
      dropZone === "into" && styles.dropInto,
      draggingId === node.id && styles.dragging,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <li key={node.id} data-ui="DocTree.item" data-id={node.id}>
        <div
          className={rowClass}
          style={{ paddingLeft: 4 + depth * 14 }}
          data-ui="DocTree.row"
          data-id={node.id}
          data-drop={dropZone ?? undefined}
          draggable={canDrag(node)}
          onDragStart={(e) => onDragStart(e, node, title)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOver(e, node, children.length > 0)}
          onDragLeave={(e) => onDragLeave(e, node)}
          onDrop={(e) => onDrop(e, node)}
        >
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
            // The row is dragged, not the link (that would drag its URL).
            draggable={false}
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
    <nav aria-label="ドキュメントツリー" data-ui="DocTree" aria-busy={moving}>
      <ul className={styles.list}>{entries.map((e) => renderNode(e, 0, new Set([e.id])))}</ul>
    </nav>
  );
}
