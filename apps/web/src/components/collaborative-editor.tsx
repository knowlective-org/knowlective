"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { yUndoPluginKey } from "y-prosemirror";
import { filterSuggestionItems } from "@blocknote/core";
import { ja } from "@blocknote/core/locales";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { getCollabToken } from "@/app/(app)/actions";
import { CHILDREN_CHANGED, PAGE_DELETED, PAGE_MOVED } from "@/lib/collab-events";
import { MAX_TITLE_LENGTH, TITLE_FIELD, UNTITLED, displayTitle } from "@/lib/page-title";
import { PageEditorContext, type PageEditorContextValue } from "./editor/page-context";
import { customSlashMenuItems, editorSchema } from "./editor/schema";
import { showAlert } from "./dialog";
import { EditorPlaceholder } from "./editor-placeholder";
import styles from "./collaborative-editor.module.css";

const CURSOR_COLORS = ["#5b8def", "#e5484d", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f"];

// The collaboration WebSocket is served by the same process and origin as the
// app (server/collab.ts, COLLAB_PATH), so no separate URL needs configuring.
function collabUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/collab`;
}

// Stable per-user cursor color.
function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

// Same markup as BlockNote's default collaboration cursor, but with the label
// permanently expanded ([data-active] is what its CSS keys the label on).
function renderCursorWithLabel(user: { name: string; color: string }): HTMLElement {
  const hex = user.color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const textColor = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b) <= 0.179 ? "white" : "black";
  const style = `background-color: ${user.color}; color: ${textColor}`;

  const base = document.createElement("span");
  base.classList.add("bn-collaboration-cursor__base");
  base.setAttribute("data-active", "");
  const caret = document.createElement("span");
  caret.setAttribute("contenteditable", "false");
  caret.classList.add("bn-collaboration-cursor__caret");
  caret.setAttribute("style", style);
  const label = document.createElement("span");
  label.classList.add("bn-collaboration-cursor__label");
  label.setAttribute("style", style);
  label.textContent = user.name;
  caret.append(label);
  // Word joiners keep the caret from affecting line breaks.
  base.append("⁠", caret, "⁠");
  return base;
}

type Props = {
  pageId: string;
  readOnly: boolean;
  user: { id: string; name: string };
  onTitleChange?: (title: string) => void;
};

// Connects to the Hocuspocus collaboration server and syncs the page's title
// and BlockNote body over Yjs. The collab server authorizes each connection
// with a short-lived token minted by the getCollabToken Server Action; the
// provider calls it again on every reconnect.
// Waits before reconnecting after a refused connection. Refusals are usually
// final (no access, page deleted), but can also be transient: the token
// request failing for a moment (network, a server restart or, in
// development, a recompile) or the server failing to check access. So the
// editor tries again a few times before saying the page can't be opened.
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export function CollaborativeEditor(props: Props) {
  const router = useRouter();
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  // Bumped to replace the provider with a fresh one (new token, new socket).
  const [attempt, setAttempt] = useState(0);
  // Refusals since the last successful sync.
  const failures = useRef(0);
  // The provider whose first sync finished. Until then the document (and
  // its title) is empty, so the placeholder is shown instead.
  const [synced, setSynced] = useState<HocuspocusProvider | null>(null);
  // Shown instead of the editor once it can't be used any more.
  const [failure, setFailure] = useState<string | null>(null);

  // One connection per mounted page, closed when leaving it — navigating to
  // another page would otherwise leave the old socket open. The page screen
  // remounts this component per page (key={pageId}), so there's no stale
  // provider to reset on cleanup.
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const p = new HocuspocusProvider({
      url: collabUrl(),
      name: props.pageId,
      document: new Y.Doc(),
      token: () => getCollabToken(props.pageId),
      onSynced: () => {
        failures.current = 0;
        setSynced(p);
      },
      // Also fires when getCollabToken() itself throws.
      onAuthenticationFailed: () => {
        const delay = RETRY_DELAYS_MS[failures.current++];
        if (delay === undefined) {
          setFailure("このページを開けませんでした。再読み込みしてください。");
          return;
        }
        retryTimer = setTimeout(() => setAttempt((n) => n + 1), delay);
      },
      onStateless: ({ payload }) => {
        try {
          const type = (JSON.parse(payload) as { type?: string }).type;
          if (type === PAGE_DELETED) {
            setFailure("このページはごみ箱に移動されました。");
          } else if (type === PAGE_MOVED) {
            // The server closes this connection next. Reconnect with a fresh
            // token (access is checked again), and refresh the screen: the
            // sidebar and this page's access may have changed.
            retryTimer = setTimeout(() => setAttempt((n) => n + 1), 0);
            router.refresh();
          }
        } catch {
          // Not ours.
        }
      },
    });
    // Opening the socket is a side effect tied to mount/unmount (and must
    // survive StrictMode's double effect run), so it can't happen in render.
    setProvider(p);
    return () => {
      clearTimeout(retryTimer);
      p.destroy();
    };
  }, [props.pageId, attempt, router]);

  if (failure) return <EditorPlaceholder message={failure} />;
  if (!provider || synced !== provider) return <EditorPlaceholder />;
  return <EditorBody {...props} provider={provider} />;
}

// BlockNote calls this for dropped/pasted files and the file blocks' upload
// button; the returned URL becomes the block's src (served with a membership
// check by /api/files/<id>).
async function uploadFile(pageId: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`/api/files?pageId=${encodeURIComponent(pageId)}`, { method: "POST", body });
  const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !data?.url) {
    const message = data?.error ?? "ファイルのアップロードに失敗しました。";
    void showAlert(message, { title: "アップロードできません" });
    throw new Error(message);
  }
  return data.url;
}

// Editors in the middle of a paste: the H1 rule in EditorBody leaves the
// pasted headings to shiftPastedHeadings.
const pasting = new WeakSet<object>();

type AnyBlock = { id: string; type: string; props: Record<string, unknown>; children: AnyBlock[] };

// "type:level" of every block, by id.
function blockKinds(blocks: AnyBlock[], into = new Map<string, string>()) {
  for (const block of blocks) {
    into.set(block.id, `${block.type}:${block.props.level ?? ""}`);
    blockKinds(block.children, into);
  }
  return into;
}

// Headings a paste brought in: new blocks, or blocks the paste turned into a
// heading (pasting into an empty line reuses that line's block). Headings
// that only received pasted text keep their level.
function shiftPastedHeadings(
  editor: { document: unknown; updateBlock: (id: string, update: { type: "heading"; props: { level: 2 | 3 | 4 | 5 | 6 } }) => unknown },
  before: Map<string, string>,
) {
  const walk = (blocks: AnyBlock[]) => {
    for (const block of blocks) {
      if (block.type === "heading") {
        const level = Number(block.props.level);
        if (before.get(block.id) !== `heading:${level}`) {
          const next = Math.min(level + 1, 6) as 2 | 3 | 4 | 5 | 6;
          if (next !== level) editor.updateBlock(block.id, { type: "heading", props: { level: next } });
        }
      }
      walk(block.children);
    }
  };
  walk(editor.document as AnyBlock[]);
}

function EditorBody({
  pageId,
  readOnly,
  user,
  onTitleChange,
  provider,
}: Props & { provider: HocuspocusProvider }) {
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: editorSchema,
      dictionary: ja,
      // Headings pasted from outside yosuga (HTML or Markdown) move down one
      // level — H1→H2 … H5→H6, H6 stays — keeping their relative structure
      // under the page title. Copy and paste within yosuga (blocknote/html)
      // keeps the levels as they are.
      pasteHandler: ({ event, editor, defaultPasteHandler }) => {
        if (event.clipboardData?.types.includes("blocknote/html")) return defaultPasteHandler();
        const before = blockKinds(editor.document as AnyBlock[]);
        pasting.add(editor);
        try {
          return defaultPasteHandler();
        } finally {
          pasting.delete(editor);
          shiftPastedHeadings(editor, before);
        }
      },
      // Guests can't add files; without uploadFile BlockNote ignores drops.
      uploadFile: readOnly ? undefined : (file: File) => uploadFile(pageId, file),
      collaboration: {
        fragment: provider.document.getXmlFragment("blocknote"),
        user: { name: user.name, color: colorFor(user.id) },
        provider: { awareness: provider.awareness ?? undefined },
        // Keep collaborators' name labels visible. The default ("activity")
        // hides a label shortly after that person stops moving or typing.
        // BlockNote 0.54's own "always" never sets the data-active attribute
        // its CSS needs to expand the label, so we render the cursor with it.
        showCursorLabels: "always",
        renderCursor: renderCursorWithLabel,
      },
    }),
    [provider],
  );

  // One H1 per page: the title. Turn H1s in the body into H2 — those already
  // in the page when it opens, and those this user's own changes bring in
  // (e.g. pasted HTML). Remote changes are left to the editor that made them;
  // read-only viewers never write.
  useEffect(() => {
    if (readOnly) return;
    const demoteH1 = (blocks: AnyBlock[]) => {
      for (const block of blocks) {
        if (block.type === "heading" && block.props.level === 1) {
          editor.updateBlock(block.id, { type: "heading", props: { level: 2 } });
        }
        demoteH1(block.children);
      }
    };
    demoteH1(editor.document as AnyBlock[]);
    return editor.onChange((_, { getChanges }) => {
      if (pasting.has(editor)) return;
      const added = getChanges().filter((c) => c.type !== "delete" && c.source.type !== "yjs-remote");
      demoteH1(added.map((c) => c.block as AnyBlock));
    });
  }, [editor, readOnly]);

  // Undo/redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) uses y-prosemirror's
  // UndoManager, which only undoes this user's own changes. Its plugin
  // destroys the UndoManager whenever the editor view is destroyed, but the
  // editor state (holding that same UndoManager) is reused when the view is
  // mounted again — React StrictMode does exactly that in development — and
  // Ctrl+Z then has nothing to undo. Reattach it if so. Runs after
  // BlockNoteView (a child) has mounted the view.
  useEffect(() => {
    const undoManager = yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager;
    if (!undoManager || undoManager.trackedOrigins.has(undoManager)) return;
    undoManager.trackedOrigins.add(undoManager);
    undoManager.doc.on("afterTransaction", undoManager.afterTransactionHandler);
    undoManager.doc.on("destroy", undoManager.destroy);
  }, [editor]);

  // Child-page blocks refetch when the collab server says this page's
  // children changed (lib/collab-events.ts), and after a reconnect, since
  // notifications sent while offline are lost.
  const events = useMemo(() => new EventTarget(), []);
  const pageContext = useMemo<PageEditorContextValue>(
    () => ({
      pageId,
      onChildrenChanged(listener) {
        events.addEventListener(CHILDREN_CHANGED, listener);
        return () => events.removeEventListener(CHILDREN_CHANGED, listener);
      },
    }),
    [pageId, events],
  );
  useEffect(() => {
    const emit = () => events.dispatchEvent(new Event(CHILDREN_CHANGED));
    const onStateless = ({ payload }: { payload: string }) => {
      try {
        if ((JSON.parse(payload) as { type?: string }).type === CHILDREN_CHANGED) emit();
      } catch {
        // Not ours.
      }
    };
    let synced = false;
    const onSynced = () => {
      if (synced) emit();
      synced = true;
    };
    provider.on("stateless", onStateless);
    provider.on("synced", onSynced);
    return () => {
      provider.off("stateless", onStateless);
      provider.off("synced", onSynced);
    };
  }, [provider, events]);

  return (
    <>
      <TitleField
        ytext={provider.document.getText(TITLE_FIELD)}
        readOnly={readOnly}
        onChange={onTitleChange}
        onEnter={() => editor.focus()}
      />
      <PageEditorContext.Provider value={pageContext}>
        <BlockNoteView editor={editor} editable={!readOnly} theme="light" slashMenu={false} data-ui="EditorBody.editor">
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...customSlashMenuItems(editor)], query)
            }
          />
        </BlockNoteView>
      </PageEditorContext.Provider>
    </>
  );
}

// A plain textarea bound to a Y.Text: local edits are applied as a minimal
// insert/delete, and remote edits shift the caret instead of resetting it.
function TitleField({
  ytext,
  readOnly,
  onChange,
  onEnter,
}: {
  ytext: Y.Text;
  readOnly: boolean;
  onChange?: (title: string) => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());

  useEffect(() => {
    const sync = (event?: Y.YTextEvent) => {
      const el = ref.current;
      const next = ytext.toString();
      if (!event || event.transaction.local || !el || document.activeElement !== el) {
        setValue(next);
        return;
      }
      // Remote edit while typing: keep the caret next to the same characters.
      const shift = (pos: number) => {
        let index = 0;
        let result = pos;
        for (const op of event.delta) {
          if (op.retain) index += op.retain;
          else if (op.insert) {
            const len = typeof op.insert === "string" ? op.insert.length : 1;
            if (index <= pos) result += len;
            index += len;
          } else if (op.delete && index < pos) {
            result -= Math.min(op.delete, pos - index);
          }
        }
        return result;
      };
      const start = shift(el.selectionStart);
      const end = shift(el.selectionEnd);
      setValue(next);
      requestAnimationFrame(() => el.setSelectionRange(start, end));
    };
    sync();
    ytext.observe(sync);
    return () => ytext.unobserve(sync);
  }, [ytext]);

  useEffect(() => {
    onChange?.(value);
    document.title = `${displayTitle(value)} | yosuga`;
    // Grow with the text instead of scrolling inside the field.
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value, onChange]);

  return (
    <textarea
      ref={ref}
      className={styles.title}
      data-ui="TitleField"
      value={value}
      placeholder={UNTITLED}
      readOnly={readOnly}
      rows={1}
      maxLength={MAX_TITLE_LENGTH}
      aria-label="ページタイトル"
      spellCheck={false}
      onKeyDown={(e) => {
        // Enter moves to the body, like Notion. Not while an IME is composing.
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        }
      }}
      onChange={(e) => {
        // A title is a single line.
        const next = e.target.value.replace(/[\r\n]+/g, " ");
        const prev = ytext.toString();
        let start = 0;
        while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
        let end = 0;
        while (
          end < prev.length - start &&
          end < next.length - start &&
          prev[prev.length - 1 - end] === next[next.length - 1 - end]
        ) {
          end++;
        }
        ytext.doc!.transact(() => {
          const removed = prev.length - start - end;
          if (removed > 0) ytext.delete(start, removed);
          const inserted = next.slice(start, next.length - end);
          if (inserted) ytext.insert(start, inserted);
        });
        setValue(next);
      }}
    />
  );
}
