"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo } from "react";
import { CollabConnection } from "@/components/collab-connection";
import { showAlert } from "@/components/dialog";
import { TitleField } from "@/components/title-field";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { EXPORT_WHITEBOARD_EVENT } from "@/lib/page-export";
import { beginSaving } from "@/lib/saving-status";
import { TITLE_FIELD } from "@/lib/page-title";
import { PageEditorContext, useCollabPageContext } from "@/components/editor/page-context";
import { ReviewProvider } from "@/components/editor/review-pane";
import { type WhiteboardItem, readItems } from "@/lib/whiteboard";
import { focusFromSearch } from "@/lib/whiteboard-focus";
import type { WhiteboardExportFormat } from "./export-download";
import { WhiteboardCanvas } from "./whiteboard-canvas";

type Props = {
  pageId: string;
  readOnly: boolean;
  user: { id: string };
  onTitleChange?: (title: string) => void;
};

// A whiteboard page: the title and the board, both in the page's Yjs
// document, edited together over the collaboration connection. Its items can
// have chats about them (review-pane.tsx), as a document's blocks can.
export function WhiteboardEditor(props: Props) {
  return <CollabConnection pageId={props.pageId}>{(provider) => <WhiteboardBody {...props} provider={provider} />}</CollabConnection>;
}

function WhiteboardBody({ pageId, readOnly, user, onTitleChange, provider }: Props & { provider: HocuspocusProvider }) {
  const t = useTranslations("whiteboard");
  const displayTitle = useDisplayTitle();
  const locale = useLocale();
  // A link to items of the board (`?items=…&groups=…`): opened at them.
  const searchParams = useSearchParams();
  const linkKey = `${searchParams.get("items") ?? ""}|${searchParams.get("groups") ?? ""}`;
  const target = useMemo(() => {
    const [items, groups] = linkKey.split("|");
    return focusFromSearch(new URLSearchParams({ items, groups }));
  }, [linkKey]);
  const pageContext = useCollabPageContext(provider, pageId, user.id);
  // Exports (PNG, SVG or PDF) of items: the whole board as it is now (the
  // page menu), or those picked (the board's menu). The export code is
  // loaded only then.
  const exportItems = useCallback(
    (items: WhiteboardItem[], format: WhiteboardExportFormat) => {
      void import("./export-download")
        .then(({ exportWhiteboard }) => exportWhiteboard(items, format, displayTitle(provider.document.getText(TITLE_FIELD).toString()), locale))
        .catch(() => showAlert(t("exportFailed")));
    },
    [provider, displayTitle, locale, t],
  );
  useEffect(() => {
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      exportItems(readItems(provider.document), detail === "svg" || detail === "pdf" ? detail : "png");
    };
    window.addEventListener(EXPORT_WHITEBOARD_EVENT, onExport);
    return () => window.removeEventListener(EXPORT_WHITEBOARD_EVENT, onExport);
  }, [provider, exportItems]);

  // The saving mark at the top of the page, as for a document.
  useEffect(() => {
    let finish: (() => void) | null = null;
    const update = () => {
      if (provider.hasUnsyncedChanges) finish ??= beginSaving();
      else {
        finish?.();
        finish = null;
      }
    };
    update();
    provider.on("unsyncedChanges", update);
    return () => {
      provider.off("unsyncedChanges", update);
      finish?.();
    };
  }, [provider]);

  return (
    <>
      <TitleField
        ytext={provider.document.getText(TITLE_FIELD)}
        readOnly={readOnly}
        onChange={onTitleChange}
        onEnter={() => document.querySelector<HTMLElement>('[data-ui="Whiteboard.canvas"]')?.focus()}
      />
      <PageEditorContext.Provider value={pageContext}>
        <ReviewProvider>
          <WhiteboardCanvas doc={provider.document} readOnly={readOnly} awareness={provider.awareness} pageId={pageId} onExport={exportItems} target={target} />
        </ReviewProvider>
      </PageEditorContext.Provider>
    </>
  );
}
