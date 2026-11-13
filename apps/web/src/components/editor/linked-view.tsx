"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PagePickerDialog } from "@/components/page-picker-dialog";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { LINKED_UNSET, isLinkedView, linkedSource, type LinkableBlock } from "@/lib/linked-views";
import { PageLink } from "./page-link";
import { usePageEditor } from "./page-context";
import styles from "./child-blocks.module.css";

// What the child page table, board and calendar share as linked views
// (lib/linked-views.ts): which page's child pages to load, the link to that
// page and choosing it. The columns stay the source page's own: a linked view
// doesn't add or change them.

// Blocks inserted from the slash menu in this tab, to open the picker for
// as they first show (others' screens showing the new block don't).
const pickOnMount = new Set<string>();

export function pickWhenShown(blockId: string) {
  pickOnMount.add(blockId);
}

// `sourceId` for useChildrenData(): undefined for the block's own page, ""
// while no page is chosen, or the chosen page (the block's own page counts
// as its own).
export function useLinkedView(source: string): { linked: boolean; sourceId: string | undefined } {
  const { pageId } = usePageEditor();
  const id = linkedSource(source);
  if (!isLinkedView(source) || id === pageId) return { linked: false, sourceId: undefined };
  return { linked: true, sourceId: id ?? "" };
}

const KIND_KEY = { childTable: "table", childBoard: "board", childCalendar: "calendar" } as const;

// The title shown while the block has none: the source page's, once it can
// be shown (never one the viewer can't see).
export function useLinkedPlaceholder(type: LinkableBlock, page: { title: string } | null | undefined): string {
  const t = useTranslations("editor.linkedView");
  const displayTitle = useDisplayTitle();
  return page ? t("titleOf", { title: displayTitle(page.title) }) : t(KIND_KEY[type]);
}

// In the block's header: the page whose child pages are shown (a link, once
// loaded) and, for those who can edit, choosing another.
export function LinkedSource({
  blockId,
  source,
  page,
  editable,
  onChoose,
}: {
  blockId: string;
  source: string;
  // The source page as loaded for this viewer (null: can't be shown).
  page: { title: string; icon: string | null } | null | undefined;
  editable: boolean;
  onChoose: (source: string) => void;
}) {
  const t = useTranslations("editor.linkedView");
  const displayTitle = useDisplayTitle();
  const { pageId } = usePageEditor();
  // Open at once for a block just inserted here (once: not when it shows again).
  const [picking, setPicking] = useState(() => editable && source === LINKED_UNSET && pickOnMount.has(blockId));
  const sourceId = linkedSource(source);
  useEffect(() => {
    pickOnMount.delete(blockId);
  }, [blockId]);

  return (
    <>
      {sourceId && page && (
        <PageLink
          href={`/pages/${sourceId}`}
          className={styles.sourceLink}
          title={t("openSource")}
          data-ui="LinkedSource.sourceLink"
          data-id={sourceId}
        >
          <span aria-hidden>🔗</span>
          <span aria-hidden>{page.icon ?? "📄"}</span>
          <span>{displayTitle(page.title)}</span>
        </PageLink>
      )}
      {editable && (
        <button
          type="button"
          className={sourceId ? styles.toolButton : styles.primaryButton}
          onClick={() => setPicking(true)}
          data-ui={sourceId ? "LinkedSource.changeButton" : "LinkedSource.chooseButton"}
        >
          {sourceId ? t("change") : t("choose")}
        </button>
      )}
      {picking && (
        <PagePickerDialog
          title={t("pickTitle")}
          lead={t("pickLead")}
          kind="parent"
          exclude={pageId}
          onPick={onChoose}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

// The body of a linked view without a page yet.
export function LinkedUnsetNote() {
  const t = useTranslations("editor.linkedView");
  return (
    <p className={styles.muted} data-ui="LinkedSource.status">
      {t("none")}
    </p>
  );
}
