"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { loadChat, postChatMessage } from "@/app/(app)/pages/[pageId]/chat-actions";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatData } from "@/lib/chat-types";
import { beginSaving } from "@/lib/saving-status";
import { showAlert } from "@/components/dialog";
import { useChildrenData, usePageEditor } from "./page-context";
import styles from "./chat-block.module.css";
import { BLOCK_CONFIGS } from "./block-configs";

// Chat block: a log of messages with a form below it; a new message goes at
// the bottom of the log, the viewer's own on the right, everyone else's on
// the left with their name. The messages are kept by the server (lib/chat.ts),
// keyed by this block's id, so no one can change another person's message;
// the document holds only the block. Everyone with the page open is told of
// new messages (the same notice as child pages) and refetches.
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
          <Log data={data} />
          {data.canPost && <Composer blockId={blockId} onPosted={reload} />}
        </>
      )}
    </div>
  );
}

function Log({ data }: { data: ChatData }) {
  const t = useTranslations("editor.chat");
  const format = useFormatter();
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
        <div
          key={m.id}
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
            <time dateTime={m.createdAt}>{format.dateTime(new Date(m.createdAt), { dateStyle: "short", timeStyle: "short" })}</time>
          </div>
          <div className={styles.bubble} data-ui="ChatBlock.text">
            {m.text}
          </div>
        </div>
      ))}
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
