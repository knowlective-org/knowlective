"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { getCollabToken } from "@/app/(app)/actions";
import { MAX_TITLE_LENGTH, TITLE_FIELD, UNTITLED, displayTitle } from "@/lib/page-title";
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
export function CollaborativeEditor(props: Props) {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);

  // One connection per mounted page, closed when leaving it — navigating to
  // another page would otherwise leave the old socket open. The page screen
  // remounts this component per page (key={pageId}), so there's no stale
  // provider to reset on cleanup.
  useEffect(() => {
    const p = new HocuspocusProvider({
      url: collabUrl(),
      name: props.pageId,
      document: new Y.Doc(),
      token: () => getCollabToken(props.pageId),
    });
    // Opening the socket is a side effect tied to mount/unmount (and must
    // survive StrictMode's double effect run), so it can't happen in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvider(p);
    return () => p.destroy();
  }, [props.pageId]);

  if (!provider) return null;
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
    window.alert(message);
    throw new Error(message);
  }
  return data.url;
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

  return (
    <>
      <TitleField
        ytext={provider.document.getText(TITLE_FIELD)}
        readOnly={readOnly}
        onChange={onTitleChange}
        onEnter={() => editor.focus()}
      />
      <BlockNoteView editor={editor} editable={!readOnly} theme="light" />
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
