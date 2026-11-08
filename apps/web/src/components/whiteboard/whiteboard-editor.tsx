"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { CollabConnection } from "@/components/collab-connection";
import { showAlert } from "@/components/dialog";
import { TitleField } from "@/components/title-field";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { EXPORT_WHITEBOARD_EVENT } from "@/lib/page-export";
import { beginSaving } from "@/lib/saving-status";
import { TITLE_FIELD } from "@/lib/page-title";
import { WhiteboardCanvas } from "./whiteboard-canvas";

type Props = {
  pageId: string;
  readOnly: boolean;
  onTitleChange?: (title: string) => void;
};

// A whiteboard page: the title and the board, both in the page's Yjs
// document, edited together over the collaboration connection.
export function WhiteboardEditor(props: Props) {
  return <CollabConnection pageId={props.pageId}>{(provider) => <WhiteboardBody {...props} provider={provider} />}</CollabConnection>;
}

function WhiteboardBody({ pageId, readOnly, onTitleChange, provider }: Props & { provider: HocuspocusProvider }) {
  const t = useTranslations("whiteboard");
  const displayTitle = useDisplayTitle();
  // The page menu's export (PNG or SVG): the board as it is now. The export
  // code is loaded only then.
  useEffect(() => {
    const onExport = (e: Event) => {
      const format = (e as CustomEvent<unknown>).detail === "svg" ? "svg" : "png";
      void import("./export-download")
        .then(({ exportWhiteboard }) => exportWhiteboard(provider.document, format, displayTitle(provider.document.getText(TITLE_FIELD).toString())))
        .catch(() => showAlert(t("exportFailed")));
    };
    window.addEventListener(EXPORT_WHITEBOARD_EVENT, onExport);
    return () => window.removeEventListener(EXPORT_WHITEBOARD_EVENT, onExport);
  }, [provider, displayTitle, t]);

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
      <WhiteboardCanvas doc={provider.document} readOnly={readOnly} awareness={provider.awareness} pageId={pageId} />
    </>
  );
}
