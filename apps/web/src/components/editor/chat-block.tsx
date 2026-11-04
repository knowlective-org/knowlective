"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { deleteChatMessage, editChatMessage, loadChat, postChatMessage } from "@/app/(app)/pages/[pageId]/chat-actions";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatData, type ChatMessageView } from "@/lib/chat-types";
import { beginSaving } from "@/lib/saving-status";
import { showAlert, showConfirm } from "@/components/dialog";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./chat-block.module.css";
import { BLOCK_CONFIGS } from "./block-configs";

// Chat block: a log of messages with a form below it; a new message goes at
// the bottom of the log, the viewer's own on the right, everyone else's on
// the left with their name. The messages are kept by the server (lib/chat.ts),
// keyed by this block's id, so no one can change another person's message;
// the document holds only the block. Its author can change a message's text
// (marked edited, with when) or take it back (it then shows as "unsent");
// nobody else can. Everyone with the page open is
// told of new and changed messages (the same notice as child pages) and
// refetches.
export const chatBlock = createReactBlockSpec(BLOCK_CONFIGS.chat, {
  render: ({ block }) => <Chat blockId={block.id} />,
});

function Chat({ blockId }: { blockId: string }) {
  const t = useTranslations("editor.chat");
  const { data, reload } = useChildrenData<ChatData>((pageId) => loadChat(pageId, blockId));
  return (
    <div className={styles.block} contentEditable={false} data-ui="ChatBlock">
      <div className={styles.label}>
        <span aria-hidden>💬</span> {t("label")}
      </div>
      {data === undefined ? (
        <p className={styles.muted}>{t("loading")}</p>
      ) : data === null ? (
        <p className={styles.muted}>{t("cannotShow")}</p>
      ) : (
        <>
          <Log data={data} onEdited={reload} />
          {data.canPost && <Composer blockId={blockId} onPosted={reload} />}
        </>
      )}
    </div>
  );
}

function Log({ data, onEdited }: { data: ChatData; onEdited: () => Promise<void> }) {
  const t = useTranslations("editor.chat");
  const ref = useRef<HTMLDivElement>(null);
  const last = data.messages.at(-1)?.id;
  // The newest message in view whenever one arrives.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [last]);
  if (data.messages.length === 0) {
    return (
      <p className={styles.muted} data-ui="ChatBlock.empty">
        {t("empty")}
      </p>
    );
  }
  return (
    <div className={styles.log} ref={ref} role="log" aria-label={t("label")} data-ui="ChatBlock.log">
      {data.messages.map((m) => (
        // Own messages can be changed while posting is allowed (the same access).
        <Message key={m.id} message={m} editable={m.mine && data.canPost && !m.deleted} onEdited={onEdited} />
      ))}
    </div>
  );
}

function Message({
  message: m,
  editable,
  onEdited,
}: {
  message: ChatMessageView;
  editable: boolean;
  onEdited: () => Promise<void>;
}) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const format = useFormatter();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const short = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  const remove = async () => {
    if (saving) return;
    const ok = await showConfirm(t("deleteConfirm"), { confirmLabel: t("delete"), danger: true });
    if (!ok) return;
    setSaving(true);
    const done = beginSaving();
    try {
      const result = await deleteChatMessage(m.id).catch(() => ({ error: failed }));
      if (result.error) {
        await showAlert(result.error);
        return;
      }
      await onEdited();
    } finally {
      done();
      setSaving(false);
    }
  };

  const save = async () => {
    if (draft === null || saving) return;
    if (draft.trim() === m.text) return setDraft(null);
    if (!draft.trim()) return;
    setSaving(true);
    const done = beginSaving();
    try {
      const result = await editChatMessage(m.id, draft).catch(() => ({ error: failed }));
      if (result.error) {
        await showAlert(result.error);
        return;
      }
      await onEdited();
      setDraft(null);
    } finally {
      done();
      setSaving(false);
    }
  };

  return (
    <div
      className={m.mine ? styles.mine : styles.theirs}
      data-ui="ChatBlock.messageRow"
      data-id={m.id}
      data-mine={m.mine || undefined}
    >
      <div className={styles.meta}>
        {!m.mine && m.author && (
          <span className={styles.author} style={m.color ? { color: m.color } : undefined} data-ui="ChatBlock.author">
            {m.author}
          </span>
        )}
        <time dateTime={m.createdAt}>{short(m.createdAt)}</time>
        {m.editedAt && !m.deleted && (
          <time
            dateTime={m.editedAt}
            title={format.dateTime(new Date(m.editedAt), { dateStyle: "long", timeStyle: "medium" })}
            data-ui="ChatBlock.editedStatus"
          >
            {t("edited", { date: short(m.editedAt) })}
          </time>
        )}
        {editable && draft === null && (
          <>
            <button type="button" className={styles.linkButton} onClick={() => setDraft(m.text)} data-ui="ChatBlock.editButton">
              {t("edit")}
            </button>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => void remove()}
              disabled={saving}
              data-ui="ChatBlock.deleteButton"
            >
              {t("delete")}
            </button>
          </>
        )}
      </div>
      {m.deleted ? (
        <div className={`${styles.bubble} ${styles.unsent}`} data-ui="ChatBlock.unsentStatus">
          {t("unsent")}
        </div>
      ) : draft === null ? (
        <div className={styles.bubble} data-ui="ChatBlock.text">
          {m.text}
        </div>
      ) : (
        <form
          className={styles.editForm}
          data-ui="ChatBlock.editForm"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <textarea
            className={styles.input}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void save();
              }
              if (e.key === "Escape") setDraft(null);
            }}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            aria-label={t("editLabel")}
            disabled={saving}
            data-ui="ChatBlock.editInput"
          />
          <div className={styles.editButtons}>
            <button type="button" className={styles.linkButton} onClick={() => setDraft(null)} disabled={saving} data-ui="ChatBlock.cancelButton">
              {t("cancel")}
            </button>
            <button type="submit" className={styles.sendButton} disabled={saving || !draft.trim()} data-ui="ChatBlock.saveButton">
              {t("save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// Enter sends, Shift+Enter starts a new line (not while an IME is composing).
function Composer({ blockId, onPosted }: { blockId: string; onPosted: () => Promise<void> }) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { pageId } = usePageEditor();
  useEffect(() => {
    if (!sending) ref.current?.focus({ preventScroll: true });
  }, [sending]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const done = beginSaving();
    try {
      const result = await postChatMessage(pageId, blockId, text).catch(() => ({ error: failed }));
      if (result.error) {
        await showAlert(result.error);
        return;
      }
      setText("");
      await onPosted();
    } finally {
      done();
      setSending(false);
    }
  };

  return (
    <form
      className={styles.composer}
      data-ui="ChatBlock.form"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={ref}
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        maxLength={MAX_CHAT_MESSAGE_LENGTH}
        placeholder={t("placeholder")}
        aria-label={t("inputLabel")}
        disabled={sending}
        data-ui="ChatBlock.messageInput"
      />
      <button type="submit" className={styles.sendButton} disabled={sending || !text.trim()} data-ui="ChatBlock.sendButton">
        {t("send")}
      </button>
    </form>
  );
}
