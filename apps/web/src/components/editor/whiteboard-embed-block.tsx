"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { createReactBlockSpec } from "@blocknote/react";
import { getCollabToken } from "@/app/(app)/actions";
import { type WhiteboardEmbed, loadWhiteboardEmbed } from "@/app/(app)/pages/[pageId]/whiteboard-embed-actions";
import { collabUrl } from "@/components/collab-connection";
import { PagePickerDialog } from "@/components/page-picker-dialog";
import { WhiteboardCanvas } from "@/components/whiteboard/whiteboard-canvas";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { PAGE_DELETED, PAGE_MOVED } from "@/lib/collab-events";
import { COLLAB_CLIENT_VERSION, OUTDATED_CLIENT } from "@/lib/collab-version";
import { TITLE_FIELD } from "@/lib/page-title";
import { BLOCK_CONFIGS } from "./block-configs";
import styles from "./whiteboard-embed-block.module.css";

// A whiteboard page shown in a document, read-only: it can be panned and
// zoomed, and opened. The document holds only the page's id; each viewer
// gets the board with their own access (whiteboard-embed-actions.ts), or a
// note that it can't be shown. Then, for someone signed in, the board's own
// collaboration connection takes over (its access checked again, as for
// opening it), so others' changes show as they're made; the board is never
// changed from here. Without one (a public page's visitor, or the
// connection refused), it's the board as it was when loaded: loaded again
// on "Reload" and when the viewer comes back to the tab.
export const whiteboardBlock = createReactBlockSpec(BLOCK_CONFIGS.whiteboard, {
  render: ({ block, editor }) => (
    <WhiteboardEmbedView
      pageId={block.props.pageId}
      editable={editor.isEditable}
      onChoose={(pageId) => editor.updateBlock(block, { props: { pageId } })}
    />
  ),
});

function WhiteboardEmbedView({ pageId, editable, onChoose }: { pageId: string; editable: boolean; onChoose: (pageId: string) => void }) {
  const t = useTranslations("editor.whiteboardEmbed");
  const displayTitle = useDisplayTitle();
  // What was loaded, and for which page (another page chosen: loading again).
  const [loaded, setLoaded] = useState<{ pageId: string; data: WhiteboardEmbed | null } | null>(null);
  const data = loaded?.pageId === pageId ? loaded.data : undefined;
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The live board (its whole document, from the collab server), once
  // synced; and for which load of the snapshot.
  const [live, setLive] = useState<{ data: WhiteboardEmbed; doc: Y.Doc } | null>(null);
  const liveDoc = live && live.data === data ? live.doc : null;

  // Live: coming back to the tab needs no loading again.
  const liveRef = useRef(false);
  useEffect(() => {
    liveRef.current = !!liveDoc;
  }, [liveDoc]);

  const load = useCallback(() => {
    if (!pageId) return;
    void loadWhiteboardEmbed(pageId)
      .then((result) => setLoaded({ pageId, data: result }))
      .catch(() => setLoaded({ pageId, data: null }));
  }, [pageId]);
  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !liveRef.current) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // Connected while the snapshot showed the board (the viewer may open it).
  // Refused (signed out, no access any more, an outdated screen): the
  // snapshot stays, without retrying. Moved, deleted or access changed (the
  // server closes the connection): loaded again from the start.
  useEffect(() => {
    if (!data || !pageId) return;
    let closed = false;
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: pageId,
      document: new Y.Doc(),
      token: async () => {
        const token = await getCollabToken(pageId, COLLAB_CLIENT_VERSION);
        if (token === OUTDATED_CLIENT) throw new Error("Outdated editor");
        return token;
      },
      onSynced: () => {
        if (!closed) setLive({ data, doc: provider.document });
      },
      onAuthenticationFailed: () => {
        closed = true;
        provider.destroy();
      },
      onStateless: ({ payload }) => {
        try {
          const type = (JSON.parse(payload) as { type?: string }).type;
          if (type === PAGE_DELETED || type === PAGE_MOVED) {
            closed = true;
            provider.destroy();
            setLive(null);
            load();
          }
        } catch {
          // Not ours.
        }
      },
    });
    // Nothing of this viewer's is shown on the board (no pointer).
    provider.awareness?.setLocalState(null);
    return () => {
      closed = true;
      provider.destroy();
    };
  }, [data, pageId, load]);
  const liveTitle = useLiveTitle(liveDoc);

  // The board's drags are the board's: the editor (ProseMirror, listening on
  // its own element) would take them for moving its selection, or the block.
  // (Keys aren't stopped: React's handlers, the board's among them, would
  // never see them.)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const own = (e: Event) => e.stopPropagation();
    const events = ["mousedown", "dragstart", "copy", "cut"] as const;
    for (const name of events) el.addEventListener(name, own);
    return () => {
      for (const name of events) el.removeEventListener(name, own);
    };
  }, []);

  const doc = useMemo(() => {
    if (!data) return null;
    const d = new Y.Doc();
    Y.applyUpdate(d, Uint8Array.from(atob(data.state), (c) => c.charCodeAt(0)));
    return d;
  }, [data]);

  const picker = picking && (
    <PagePickerDialog
      title={t("pickTitle")}
      lead={t("pickLead")}
      kind="whiteboard"
      onPick={onChoose}
      onClose={() => setPicking(false)}
    />
  );

  return (
    <div className={styles.block} contentEditable={false} ref={ref} data-ui="WhiteboardEmbed" data-id={pageId || undefined} data-live={liveDoc ? "" : undefined}>
      <div className={styles.header}>
        <span className={styles.title}>
          <span aria-hidden>▦</span>{" "}
          {data ? (
            <Link href={`/pages/${pageId}`} className={styles.titleLink} data-ui="WhiteboardEmbed.openLink">
              {displayTitle(liveTitle ?? data.title)}
            </Link>
          ) : (
            t("label")
          )}
        </span>
        <span className={styles.actions}>
          {data && !liveDoc && (
            <button type="button" className={styles.linkButton} onClick={load} data-ui="WhiteboardEmbed.reloadButton">
              {t("reload")}
            </button>
          )}
          {editable && pageId && (
            <button type="button" className={styles.linkButton} onClick={() => setPicking(true)} data-ui="WhiteboardEmbed.changeButton">
              {t("change")}
            </button>
          )}
        </span>
      </div>
      {!pageId ? (
        <div className={styles.empty}>
          {editable ? (
            <button type="button" className={styles.chooseButton} onClick={() => setPicking(true)} data-ui="WhiteboardEmbed.chooseButton">
              {t("choose")}
            </button>
          ) : (
            <p className={styles.muted}>{t("none")}</p>
          )}
        </div>
      ) : data === undefined ? (
        <p className={styles.muted} data-ui="WhiteboardEmbed.status">
          {t("loading")}
        </p>
      ) : data === null || !doc ? (
        <p className={styles.muted} data-ui="WhiteboardEmbed.status">
          {t("cannotShow")}
        </p>
      ) : (
        <WhiteboardCanvas
          key={liveDoc ? "live" : data.state}
          doc={liveDoc ?? doc}
          readOnly
          embedded
          dataUi="WhiteboardEmbed.board"
        />
      )}
      {picker}
    </div>
  );
}

// The live board's title, as it's typed (null before it's live).
function useLiveTitle(doc: Y.Doc | null): string | null {
  const subscribe = useCallback(
    (changed: () => void) => {
      if (!doc) return () => {};
      const text = doc.getText(TITLE_FIELD);
      text.observe(changed);
      return () => text.unobserve(changed);
    },
    [doc],
  );
  return useSyncExternalStore(
    subscribe,
    () => (doc ? doc.getText(TITLE_FIELD).toString() : null),
    () => null,
  );
}
