"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  deleteChatMessage,
  editChatMessage,
  loadChat,
  postChatMessage,
  setChatLocked,
} from "@/app/(app)/pages/[pageId]/chat-actions";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatData, type ChatMessageView } from "@/lib/chat-types";
import { chatMention, chatSegments } from "@/lib/chat-text";
import { beginSaving } from "@/lib/saving-status";
import { showAlert, showConfirm } from "@/components/dialog";
import { useChildrenData, usePageEditor } from "./page-context";
import { usePagePeople } from "./page-people";
import styles from "./chat-block.module.css";
import mentionStyles from "./mention-inline.module.css";
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
//
// A message can reply to another (quoted above it; a click on the quote
// shows the original) and mention people ("@" in the box offers those who
// can open the page; kept as `<@id>` in the text, lib/chat-text.ts). URLs in
// messages are links. Someone who can edit the page can lock the chat.
//
// The text of the messages can be selected and copied: the block's own
// listeners keep the editor (ProseMirror, which listens on its element)
// from taking the mouse and the copy as its own.
export const chatBlock = createReactBlockSpec(BLOCK_CONFIGS.chat, {
  render: ({ block }) => <Chat blockId={block.id} />,
});

type Person = { id: string; name: string };
type Reply = { id: string; author: string | null; excerpt: string };

function Chat({ blockId }: { blockId: string }) {
  const t = useTranslations("editor.chat");
  const { data, reload } = useChildrenData<ChatData>((pageId) => loadChat(pageId, blockId));
  const [replyTo, setReplyTo] = useState<Reply | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const own = (e: Event) => e.stopPropagation();
    const events = ["mousedown", "copy", "cut", "dragstart"] as const;
    for (const name of events) el.addEventListener(name, own);
    return () => {
      for (const name of events) el.removeEventListener(name, own);
    };
  }, []);
  // Posting stopped (locked, access changed): no reply under way.
  const replying = data?.canPost ? replyTo : null;

  return (
    <div className={styles.block} contentEditable={false} ref={ref} data-ui="ChatBlock">
      <div className={styles.header}>
        <div className={styles.label}>
          <span aria-hidden>💬</span> {t("label")}
        </div>
        {data?.canLock && <LockButton blockId={blockId} locked={data.locked} onChanged={reload} />}
      </div>
      {data === undefined ? (
        <p className={styles.muted}>{t("loading")}</p>
      ) : data === null ? (
        <p className={styles.muted}>{t("cannotShow")}</p>
      ) : (
        <>
          <Log data={data} onEdited={reload} onReply={data.canPost ? setReplyTo : undefined} />
          {data.locked && (
            <p className={styles.locked} role="status" data-ui="ChatBlock.lockedStatus">
              <span aria-hidden>🔒</span> {t("lockedStatus")}
            </p>
          )}
          {data.canPost && (
            <Composer blockId={blockId} replyTo={replying} onCancelReply={() => setReplyTo(null)} onPosted={reload} />
          )}
        </>
      )}
    </div>
  );
}

function LockButton({ blockId, locked, onChanged }: { blockId: string; locked: boolean; onChanged: () => Promise<void> }) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const { pageId } = usePageEditor();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (locked && !(await showConfirm(t("unlockConfirm"), { confirmLabel: t("unlock") }))) return;
    setBusy(true);
    const done = beginSaving();
    try {
      const result = await setChatLocked(pageId, blockId, !locked).catch(() => ({ error: failed }));
      if (result.error) return void (await showAlert(result.error));
      await onChanged();
    } finally {
      done();
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={styles.linkButton}
      onClick={() => void toggle()}
      disabled={busy}
      title={locked ? undefined : t("lockTitle")}
      data-ui={locked ? "ChatBlock.unlockButton" : "ChatBlock.lockButton"}
    >
      {locked ? t("unlock") : t("lock")}
    </button>
  );
}

function Log({
  data,
  onEdited,
  onReply,
}: {
  data: ChatData;
  onEdited: () => Promise<void>;
  onReply?: (reply: Reply) => void;
}) {
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
  // The message a quote is from, scrolled to and briefly marked.
  const show = (id: string) => {
    const row = ref.current?.querySelector<HTMLElement>(`[data-ui="ChatBlock.messageRow"][data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    row.classList.remove(styles.flash);
    void row.offsetWidth;
    row.classList.add(styles.flash);
  };
  return (
    <div className={styles.log} ref={ref} role="log" aria-label={t("label")} data-ui="ChatBlock.log">
      {data.messages.map((m) => (
        // Own messages can be changed while posting is allowed (the same access).
        <Message
          key={m.id}
          message={m}
          editable={m.mine && data.canPost && !m.deleted}
          onEdited={onEdited}
          onReply={onReply && !m.deleted ? () => onReply({ id: m.id, author: m.author, excerpt: excerptOf(m) }) : undefined}
          onShowQuoted={show}
        />
      ))}
    </div>
  );
}

// A message's text as one line, mentions by name (for the reply being written).
function excerptOf(m: ChatMessageView): string {
  return chatSegments(m.text)
    .map((s) => (s.type === "mention" ? `@${m.names[s.userId] ?? ""}` : s.text))
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function MessageText({ message: m }: { message: ChatMessageView }) {
  const t = useTranslations("editor.chat");
  return (
    <>
      {chatSegments(m.text).map((s, i) =>
        s.type === "link" ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className={styles.link} data-ui="ChatBlock.textLink">
            {s.text}
          </a>
        ) : s.type === "mention" ? (
          <span key={i} className={mentionStyles.mention} data-ui="ChatBlock.mention" data-id={s.userId}>
            @{m.names[s.userId] ?? t("someone")}
          </span>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

function Message({
  message: m,
  editable,
  onEdited,
  onReply,
  onShowQuoted,
}: {
  message: ChatMessageView;
  editable: boolean;
  onEdited: () => Promise<void>;
  onReply?: () => void;
  onShowQuoted: (id: string) => void;
}) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const format = useFormatter();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const picksRef = useRef<Person[]>([]);
  const short = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  const startEditing = () => {
    picksRef.current = Object.entries(m.names).map(([id, name]) => ({ id, name }));
    setDraft(toDisplay(m.text, m.names, t("someone")));
  };

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
    const text = toStored(draft, picksRef.current);
    if (text.trim() === m.text) return setDraft(null);
    if (!text.trim()) return;
    setSaving(true);
    const done = beginSaving();
    try {
      const result = await editChatMessage(m.id, text).catch(() => ({ error: failed }));
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
        {onReply && draft === null && (
          <button type="button" className={styles.linkButton} onClick={onReply} data-ui="ChatBlock.replyButton">
            {t("reply")}
          </button>
        )}
        {editable && draft === null && (
          <>
            <button type="button" className={styles.linkButton} onClick={startEditing} data-ui="ChatBlock.editButton">
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
      {m.replyTo && (
        <button
          type="button"
          className={styles.quote}
          onClick={() => onShowQuoted(m.replyTo!.id)}
          data-ui="ChatBlock.replyQuote"
          data-id={m.replyTo.id}
        >
          <span className={styles.quoteAuthor}>{t("replyQuote", { name: m.replyTo.author ?? t("someone") })}</span>
          <span className={styles.quoteText}>{m.replyTo.deleted ? t("unsentQuote") : m.replyTo.excerpt}</span>
        </button>
      )}
      {m.deleted ? (
        <div className={`${styles.bubble} ${styles.unsent}`} data-ui="ChatBlock.unsentStatus">
          {t("unsent")}
        </div>
      ) : draft === null ? (
        <div className={styles.bubble} data-ui="ChatBlock.text">
          <MessageText message={m} />
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
          <ChatInput
            value={draft}
            onValueChange={setDraft}
            picksRef={picksRef}
            onSend={() => void save()}
            onEscape={() => setDraft(null)}
            autoFocus
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

// The box shows mentions as "@name"; picks are the people chosen from the
// menu, whose "@name" becomes `<@id>` when sent (longer names first, so
// "@Ann Lee" isn't taken for "@Ann").
function toStored(display: string, picks: Person[]): string {
  let text = display;
  for (const p of [...picks].sort((a, b) => b.name.length - a.name.length)) {
    text = text.split(`@${p.name}`).join(chatMention(p.id));
  }
  return text;
}

function toDisplay(text: string, names: Record<string, string>, someone: string): string {
  return chatSegments(text)
    .map((s) => (s.type === "mention" ? `@${names[s.userId] ?? someone}` : s.text))
    .join("");
}

// The "@" being typed before the caret: what follows it so far, and where it
// is. Spaces count (names have them); the menu shows only while a name matches.
function mentionQuery(value: string, caret: number): { query: string; start: number } | null {
  const m = /(^|\s)@((?:[^\s@][^@\n]{0,29})?)$/.exec(value.slice(0, caret));
  return m ? { query: m[2], start: caret - m[2].length - 1 } : null;
}

// The message box: Enter sends, Shift+Enter starts a new line (not while an
// IME is composing); "@" offers the people who can open the page.
function ChatInput({
  value,
  onValueChange,
  picksRef,
  onSend,
  onEscape,
  inputRef,
  ...rest
}: {
  value: string;
  onValueChange: (value: string) => void;
  picksRef: { current: Person[] };
  onSend: () => void;
  onEscape?: () => void;
  inputRef?: { current: HTMLTextAreaElement | null };
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const t = useTranslations("editor.chat");
  const { pageId } = usePageEditor();
  const people = usePagePeople(pageId);
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const at = mentionQuery(value, caret);
  const q = at?.query.normalize("NFKC").toLowerCase() ?? "";
  const options =
    at && people && dismissed !== at.start
      ? people.filter((p) => p.name.normalize("NFKC").toLowerCase().includes(q)).slice(0, 8)
      : [];
  const selected = Math.min(active, Math.max(0, options.length - 1));

  const choose = (p: Person) => {
    if (!at) return;
    const inserted = `@${p.name} `;
    const next = value.slice(0, at.start) + inserted + value.slice(caret);
    if (!picksRef.current.some((x) => x.id === p.id)) picksRef.current = [...picksRef.current, p];
    onValueChange(next);
    const pos = at.start + inserted.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className={styles.inputWrap}>
      <textarea
        {...rest}
        ref={ref}
        className={styles.input}
        value={value}
        rows={Math.min(6, Math.max(1, value.split("\n").length))}
        onChange={(e) => {
          onValueChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (options.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((selected + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(options[selected]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDismissed(at!.start);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
          if (e.key === "Escape") onEscape?.();
        }}
      />
      {options.length > 0 && (
        <div className={styles.mentionMenu} role="listbox" aria-label={t("mentionMenu")} data-ui="ChatBlock.mentionMenu">
          {options.map((p, i) => (
            <div
              key={p.id}
              role="option"
              aria-selected={i === selected}
              className={styles.mentionItem}
              onMouseDown={(e) => {
                // Keep the focus (and the caret) in the box.
                e.preventDefault();
                choose(p);
              }}
              data-ui="ChatBlock.mentionItem"
              data-id={p.id}
            >
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({
  blockId,
  replyTo,
  onCancelReply,
  onPosted,
}: {
  blockId: string;
  replyTo: Reply | null;
  onCancelReply: () => void;
  onPosted: () => Promise<void>;
}) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picksRef = useRef<Person[]>([]);
  const { pageId } = usePageEditor();
  useEffect(() => {
    if (!sending) ref.current?.focus({ preventScroll: true });
  }, [sending, replyTo]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const done = beginSaving();
    try {
      const result = await postChatMessage(pageId, blockId, toStored(text, picksRef.current), replyTo?.id ?? null).catch(() => ({
        error: failed,
      }));
      if (result.error) {
        await showAlert(result.error);
        return;
      }
      setText("");
      picksRef.current = [];
      onCancelReply();
      await onPosted();
    } finally {
      done();
      setSending(false);
    }
  };

  return (
    <form
      className={styles.composerForm}
      data-ui="ChatBlock.form"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {replyTo && (
        <div className={styles.replying} data-ui="ChatBlock.replyingStatus">
          <span className={styles.quoteText}>
            <span className={styles.quoteAuthor}>{t("replyingTo", { name: replyTo.author ?? t("someone") })}</span> {replyTo.excerpt}
          </span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={onCancelReply}
            aria-label={t("cancelReply")}
            title={t("cancelReply")}
            data-ui="ChatBlock.cancelReplyButton"
          >
            ×
          </button>
        </div>
      )}
      <div className={styles.composer}>
        <ChatInput
          inputRef={ref}
          value={text}
          onValueChange={setText}
          picksRef={picksRef}
          onSend={() => void send()}
          onEscape={replyTo ? onCancelReply : undefined}
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          placeholder={t("placeholder")}
          aria-label={t("inputLabel")}
          disabled={sending}
          data-ui="ChatBlock.messageInput"
        />
        <button type="submit" className={styles.sendButton} disabled={sending || !text.trim()} data-ui="ChatBlock.sendButton">
          {t("send")}
        </button>
      </div>
    </form>
  );
}
