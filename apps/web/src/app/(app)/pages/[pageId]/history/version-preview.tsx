"use client";

import { useMemo } from "react";
import { resolveAppUrl } from "@/lib/base-path";
import * as Y from "yjs";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { PageEditorContext, type PageEditorContextValue } from "@/components/editor/page-context";
import { editorSchema } from "@/components/editor/schema";
import { useLocale } from "next-intl";
import { blockNoteDictionary } from "@/i18n/blocknote";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { TITLE_FIELD } from "@/lib/page-title";
import styles from "@/components/collaborative-editor.module.css";

// A saved version, rendered read-only by the same editor (and schema) as the
// page, from a local Y.Doc that is never connected anywhere. Child-page
// blocks show the page's current children, not those at the time.
export function VersionPreview({ pageId, state }: { pageId: string; state: string }) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    Y.applyUpdate(d, Uint8Array.from(atob(state), (c) => c.charCodeAt(0)));
    return d;
  }, [state]);
  const locale = useLocale();
  const displayTitle = useDisplayTitle();
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: editorSchema,
      dictionary: blockNoteDictionary(locale),
      resolveFileUrl: async (url: string) => resolveAppUrl(url),
      collaboration: { fragment: doc.getXmlFragment("blocknote"), user: { name: "", color: "#000000" } },
    }),
    [doc, locale],
  );
  const context = useMemo<PageEditorContextValue>(() => ({ pageId, onChildrenChanged: () => () => {} }), [pageId]);

  return (
    <div data-ui="VersionPreview">
      <div className={styles.title}>{displayTitle(doc.getText(TITLE_FIELD).toString())}</div>
      <PageEditorContext.Provider value={context}>
        <BlockNoteView editor={editor} editable={false} theme="light" />
      </PageEditorContext.Provider>
    </div>
  );
}
