"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  closeChatPoll,
  deleteChatMessage,
  editChatMessage,
  loadChat,
  postChatMessage,
  postChatPoll,
  setChatLocked,
  setChatReaction,
  voteChatPoll,
} from "@/app/(app)/pages/[pageId]/chat-actions";
import {
  CHAT_REACTIONS,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MIN_POLL_OPTIONS,
  type ChatData,
  type ChatMessageView,
  type ChatPollView,
  type ChatReactionEmoji,
} from "@/lib/chat-types";
import { EVERYONE, chatMention, chatSegments } from "@/lib/chat-text";
import { type ChatBlockNode, type ChatFormat, type ChatInline, applyChatFormat, chatBlocks, chatMarkdownPlain } from "@/lib/chat-markdown";
import { beginSaving } from "@/lib/saving-status";
import { insideCodeFence, lineIndent } from "@/lib/auto-indent";
import { showAlert, showConfirm } from "@/components/dialog";
import { useChildrenData, usePageEditor } from "./page-context";
import { usePagePeople } from "./page-people";
import styles from "./chat-block.module.css";
import mentionStyles from "./mention-inline.module.css";
import { BLOCK_CONFIGS } from "./block-configs";
import { BlockTitle } from "./block-title";
import { Icon, type IconName } from "@/components/icons";

// Chat block: a title, then a log of messages with a form below it; a new message goes at
// the bottom of the log, the viewer's own on the right, everyone else's on
// the left with their name. The messages are kept by the server (lib/chat.ts),
// keyed by this block's id, so no one can change another person's message;
// the document holds only the block. Its author can change a message's text
// (in the message box below the log, as when writing one; marked edited, with
// when) or take it back (it then shows as "unsent"); nobody else can. Everyone with the page open is
// told of new and changed messages (the same notice as child pages) and
// refetches.
//
// A message can reply to another (quoted above it; a click on the quote
// shows the original) and mention people ("@" in the box offers those who
// can open the page; kept as `<@id>` in the text, lib/chat-text.ts). URLs in
// messages are links. Someone who can edit the page can lock the chat, and
// react to others' messages with an emoji (under the bubble; the names of
// those who did on hover).
//
// A message can be a poll ("Poll" by the message box): a question with
// choices, one or several per person. Votes are named (who chose what on
// hover) and can be changed until the poll's author closes it; the question
// and choices can't be changed.
//
// The text of the messages can be selected and copied: the block's own
// listeners keep the editor (ProseMirror, which listens on its element)
// from taking the mouse and the copy as its own, and the log takes the focus
// when clicked (tabIndex -1): while the editor has the focus, ProseMirror
// reads every selection change in the page, and replaces a selection inside
// a block like this one (no editable content) with its own.
//
// The title is in the document (anyone who can edit the page can change it).
// Each viewer can fold the block to its title alone; that is kept in their
// browser (as BlockNote keeps its toggles open or closed), not shared.
export const chatBlock = createReactBlockSpec(BLOCK_CONFIGS.chat, {
  render: ({ block, editor }) => (
    <Chat
      blockId={block.id}
      title={block.props.title}
      titleEditable={editor.isEditable}
      onTitle={(title) => editor.updateBlock(block, { props: { title } })}
    />
  ),
});

const foldKey = (blockId: string) => `knowlective-chat-folded-${blockId}`;

function readFolded(blockId: string): boolean {
  try {
    return window.localStorage.getItem(foldKey(blockId)) === "true";
  } catch {
    return false;
  }
}

function saveFolded(blockId: string, folded: boolean) {
  try {
    if (folded) window.localStorage.setItem(foldKey(blockId), "true");
    else window.localStorage.removeItem(foldKey(blockId));
  } catch {
    // Not kept (storage blocked): folded for now only.
  }
}

type Person = { id: string; name: string };
type Reply = { id: string; author: string | null; excerpt: string };
type ComposerApi = { quote: (text: string) => void };

function Chat({
  blockId,
  title,
  titleEditable,
  onTitle,
}: {
  blockId: string;
  title: string;
  titleEditable: boolean;
  onTitle: (title: string) => void;
}) {
  const t = useTranslations("editor.chat");
  const [folded, setFolded] = useState(() => readFolded(blockId));
  const toggleFolded = () => {
    setFolded(!folded);
    saveFolded(blockId, !folded);
  };
  const { data, reload } = useChildrenData<ChatData>((pageId) => loadChat(pageId, blockId));
  const [replyTo, setReplyTo] = useState<Reply | null>(null);
  // The new message's box: puts selected text in it as a quote.
  const composer = useRef<ComposerApi | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingPoll, setCreatingPoll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const own = (e: Event) => e.stopPropagation();
    const events = ["mousedown", "copy", "cut", "dragstart"] as const;
    for (const name of events) el.addEventListener(name, own);
    // Keys pressed with the focus on the log (Ctrl+C, Ctrl+A, Delete): not
    // for the editor, whose shortcuts would act on its own selection.
    const ownKey = (e: KeyboardEvent) => {
      if ((e.target as Element).getAttribute("data-ui") === "ChatBlock.log") e.stopPropagation();
    };
    el.addEventListener("keydown", ownKey);
    return () => {
      for (const name of events) el.removeEventListener(name, own);
      el.removeEventListener("keydown", ownKey);
    };
  }, []);
  // Posting stopped (locked, access changed): no reply or change under way;
  // nor a change to a message taken back meanwhile.
  const replying = data?.canPost ? replyTo : null;
  const editing = data?.canPost ? (data.messages.find((m) => m.id === editingId && m.mine && !m.deleted) ?? null) : null;

  return (
    <div className={styles.block} contentEditable={false} ref={ref} data-ui="ChatBlock" data-folded={folded || undefined}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <button
            type="button"
            className={styles.foldButton}
            aria-expanded={!folded}
            aria-label={folded ? t("unfold") : t("fold")}
            title={folded ? t("unfold") : t("fold")}
            onClick={toggleFolded}
            data-ui="ChatBlock.foldButton"
          >
            <span aria-hidden>{folded ? "▸" : "▾"}</span>
          </button>
          <Icon name="chat" size={18} className={styles.titleIcon} />
          <BlockTitle value={title} placeholder={t("label")} editable={titleEditable} onSave={onTitle} uiName="ChatBlock" />
        </div>
        {!folded && data?.canLock && <LockButton blockId={blockId} locked={data.locked} onChanged={reload} />}
      </div>
      {folded ? null : data === undefined ? (
        <p className={styles.muted}>{t("loading")}</p>
      ) : data === null ? (
        <p className={styles.muted}>{t("cannotShow")}</p>
      ) : (
        <>
          <Log
            data={data}
            editingId={editing?.id ?? null}
            onEdited={reload}
            onEdit={(id) => {
              setReplyTo(null);
              setCreatingPoll(false);
              setEditingId(id);
            }}
            onReply={
              data.canPost
                ? (reply, quoted) => {
                    setEditingId(null);
                    setCreatingPoll(false);
                    setReplyTo(reply);
                    if (quoted) composer.current?.quote(quoted);
                  }
                : undefined
            }
          />
          {data.locked && (
            <p className={styles.locked} role="status" data-ui="ChatBlock.lockedStatus">
              <Icon name="lock" size={16} className={styles.inlineIcon} /> {t("lockedStatus")}
            </p>
          )}
          {data.canPost && (
            <>
              <Composer
                blockId={blockId}
                replyTo={replying}
                api={composer}
                onCancelReply={() => setReplyTo(null)}
                hidden={!!editing || creatingPoll}
                onPosted={reload}
                onPoll={() => {
                  setReplyTo(null);
                  setCreatingPoll(true);
                }}
              />
              {editing && (
                <Composer key={editing.id} blockId={blockId} editing={editing} onEndEdit={() => setEditingId(null)} onPosted={reload} />
              )}
              {creatingPoll && !editing && <PollComposer blockId={blockId} onDone={() => setCreatingPoll(false)} onPosted={reload} />}
            </>
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
  editingId,
  onEdited,
  onEdit,
  onReply,
}: {
  data: ChatData;
  // The message being changed in the message box.
  editingId: string | null;
  onEdited: () => Promise<void>;
  onEdit: (id: string) => void;
  // `quoted`: part of the message's text the viewer selected, to quote.
  onReply?: (reply: Reply, quoted?: string) => void;
}) {
  const t = useTranslations("editor.chat");
  const ref = useRef<HTMLDivElement>(null);
  const last = data.messages.at(-1)?.id;
  const selection = useMessageSelection(ref, !!onReply);
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
  const quoteSelection = () => {
    const m = selection && data.messages.find((x) => x.id === selection.messageId && !x.deleted);
    if (!m || !onReply) return;
    window.getSelection()?.removeAllRanges();
    onReply({ id: m.id, author: m.author, excerpt: oneLine(selection.text) }, selection.text);
  };
  return (
    <div className={styles.log} ref={ref} role="log" aria-label={t("label")} tabIndex={-1} data-ui="ChatBlock.log">
      {selection && onReply && (
        <button
          type="button"
          className={styles.quoteSelectionButton}
          style={{ top: selection.top, left: selection.left }}
          title={t("quoteSelectionTitle")}
          // Keep the selection until the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={quoteSelection}
          data-ui="ChatBlock.quoteSelectionButton"
        >
          <Icon name="quote" size={16} style={{ margin: 0 }} />
          {t("quoteSelection")}
        </button>
      )}
      {data.messages.map((m) => (
        // Own messages can be changed while posting is allowed (the same access);
        // a poll's text can't, but it can be closed.
        <Message
          key={m.id}
          message={m}
          editable={m.mine && data.canPost && !m.deleted}
          editing={m.id === editingId}
          canReact={!m.mine && data.canPost && !m.deleted}
          canVote={data.canPost && !m.deleted}
          onEdited={onEdited}
          onEdit={() => onEdit(m.id)}
          onReply={onReply && !m.deleted ? () => onReply({ id: m.id, author: m.author, excerpt: excerptOf(m) }) : undefined}
          onShowQuoted={show}
        />
      ))}
    </div>
  );
}

// A message's text as one line, without its formatting, mentions by name
// (for the reply being written).
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 80);

// Text selected inside one message's bubble in the log (`ref`): which
// message, the text, and where to show the "Quote" button (over the
// selection, on the screen).
function useMessageSelection(ref: { current: HTMLDivElement | null }, enabled: boolean) {
  const [selection, setSelection] = useState<{ messageId: string; text: string; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      const log = ref.current;
      const sel = window.getSelection();
      if (!log || !sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null);
      const bubbleOf = (node: Node | null) =>
        (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-ui="ChatBlock.text"]') ?? null;
      const bubble = bubbleOf(sel.anchorNode);
      if (!bubble || bubble !== bubbleOf(sel.focusNode) || !log.contains(bubble)) return setSelection(null);
      const messageId = bubble.closest<HTMLElement>('[data-ui="ChatBlock.messageRow"]')?.dataset.id;
      const text = sel.toString().trim();
      if (!messageId || !text) return setSelection(null);
      const rects = sel.getRangeAt(0).getClientRects();
      const end = rects[rects.length - 1] ?? sel.getRangeAt(0).getBoundingClientRect();
      const first = rects[0] ?? end;
      // Fixed on the screen (the log would clip it): above the selection,
      // below it at the top of the window.
      const above = first.top >= 34;
      setSelection({
        messageId,
        text,
        top: above ? first.top - 30 : end.bottom + 4,
        left: Math.max(4, Math.min(end.right - 40, window.innerWidth - 90)),
      });
    };
    document.addEventListener("selectionchange", update);
    // Scrolling (the page or the log) moves the selection.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [ref, enabled]);
  return enabled ? selection : null;
}

function excerptOf(m: ChatMessageView): string {
  return chatSegments(chatMarkdownPlain(m.text))
    .map((s) => (s.type === "mention" ? `@${m.names[s.userId] ?? ""}` : s.text))
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

// A message's text with its formatting (lib/chat-markdown.ts): React
// elements only, never HTML; links to http(s) only.
function MessageText({ message: m }: { message: ChatMessageView }) {
  const t = useTranslations("editor.chat");
  const someone = t("someone");
  const inline = (nodes: ChatInline[]): ReactNode[] =>
    nodes.map((n, i) => {
      switch (n.type) {
        case "text":
          return n.text;
        case "break":
          // The bubble keeps line breaks (pre-wrap): as a character, a copy keeps it too.
          return "\n";
        case "mention":
          return (
            <span key={i} className={mentionStyles.mention} data-ui="ChatBlock.mention" data-id={n.userId}>
              @{m.names[n.userId] ?? someone}
            </span>
          );
        case "link":
          return (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className={styles.link} data-ui="ChatBlock.textLink">
              {inline(n.children)}
            </a>
          );
        case "code":
          return (
            <code key={i} className={styles.inlineCode}>
              {mentionsAsNames(n.text, m.names, someone)}
            </code>
          );
        case "bold":
          return <strong key={i}>{inline(n.children)}</strong>;
        case "italic":
          return <em key={i}>{inline(n.children)}</em>;
        case "strike":
          return <s key={i}>{inline(n.children)}</s>;
      }
    });
  const block = (b: ChatBlockNode, i: number): ReactNode => {
    switch (b.type) {
      case "paragraph":
        return (
          <div key={i} className={styles.mdParagraph}>
            {inline(b.children)}
          </div>
        );
      case "list":
        // Not ul / li: the editor's list styles would apply (AGENTS.md).
        return (
          <div key={i} role="list" className={styles.mdList}>
            {b.items.map((item, j) => (
              <div key={j} role="listitem" className={styles.mdListItem}>
                <span className={styles.mdMarker} aria-hidden>
                  {b.ordered ? `${b.start + j}.` : "•"}
                </span>
                <span>{inline(item)}</span>
              </div>
            ))}
          </div>
        );
      case "quote":
        return (
          <blockquote key={i} className={styles.mdQuote}>
            {b.children.map(block)}
          </blockquote>
        );
      case "code":
        return (
          <pre key={i} className={styles.mdCode}>
            <code>{mentionsAsNames(b.text, m.names, someone)}</code>
          </pre>
        );
    }
  };
  return <>{chatBlocks(m.text).map(block)}</>;
}

// Code shows mentions as plain "@name" text.
function mentionsAsNames(text: string, names: Record<string, string>, someone: string): string {
  return chatSegments(text)
    .map((s) => (s.type === "mention" ? `@${names[s.userId] ?? someone}` : s.text))
    .join("");
}

function Message({
  message: m,
  editable,
  editing,
  canReact,
  canVote,
  onEdited,
  onEdit,
  onReply,
  onShowQuoted,
}: {
  message: ChatMessageView;
  editable: boolean;
  // Being changed in the message box (marked here).
  editing: boolean;
  // The viewer can add and take away their reactions (someone else's message).
  canReact: boolean;
  // The viewer can vote, if it's a poll that's still open.
  canVote: boolean;
  onEdited: () => Promise<void>;
  onEdit: () => void;
  onReply?: () => void;
  onShowQuoted: (id: string) => void;
}) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const format = useFormatter();
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

  return (
    <div
      className={m.mine ? styles.mine : styles.theirs}
      data-ui="ChatBlock.messageRow"
      data-id={m.id}
      data-mine={m.mine || undefined}
      data-editing={editing || undefined}
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
        {onReply && (
          <button type="button" className={styles.linkButton} onClick={onReply} data-ui="ChatBlock.replyButton">
            {t("reply")}
          </button>
        )}
        {editable && (
          <>
            {!editing && !m.poll && (
              <button type="button" className={styles.linkButton} onClick={onEdit} data-ui="ChatBlock.editButton">
                {t("edit")}
              </button>
            )}
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
      ) : (
        <div className={styles.bubble} data-ui="ChatBlock.text">
          {m.poll && (
            <span className={styles.pollIcon} aria-label={t("pollLabel")} role="img">
              <Icon name="poll" size={16} className={styles.inlineIcon} />{" "}
            </span>
          )}
          <MessageText message={m} />
        </div>
      )}
      {m.poll && (
        <Poll
          messageId={m.id}
          poll={m.poll}
          canVote={canVote && !m.poll.closed}
          canClose={editable && !m.poll.closed}
          onChanged={onEdited}
        />
      )}
      {(m.reactions.length > 0 || canReact) && <Reactions message={m} canReact={canReact} onChanged={onEdited} />}
    </div>
  );
}

// The reactions under a message: each emoji with how many, the names of
// those who reacted on hover. The viewer's own are marked; a click takes one
// away or adds it, and the button at the end offers the emoji to choose from.
function Reactions({
  message: m,
  canReact,
  onChanged,
}: {
  message: ChatMessageView;
  canReact: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // The palette closes on a click elsewhere (pointerdown: the block keeps
  // mousedown to itself).
  useEffect(() => {
    if (!picking) return;
    const close = (e: PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [picking]);

  const toggle = async (emoji: ChatReactionEmoji, on: boolean) => {
    setPicking(false);
    if (busy) return;
    setBusy(true);
    const done = beginSaving();
    try {
      const result = await setChatReaction(m.id, emoji, on).catch(() => ({ error: failed }));
      if (result.error) return void (await showAlert(result.error));
      await onChanged();
    } finally {
      done();
      setBusy(false);
    }
  };

  return (
    <div className={styles.reactions} data-ui="ChatBlock.reactions">
      {m.reactions.map((r) => {
        const label = t("reactionLabel", { emoji: r.emoji, count: r.count });
        const who = r.names ? `${r.emoji} ${r.names.join(", ")}` : label;
        return canReact ? (
          <button
            key={r.emoji}
            type="button"
            className={styles.reaction}
            aria-pressed={r.mine}
            aria-label={label}
            title={who}
            disabled={busy}
            onClick={() => void toggle(r.emoji, !r.mine)}
            data-ui="ChatBlock.reactionButton"
            data-id={r.emoji}
          >
            <span aria-hidden>{r.emoji}</span> {r.count}
          </button>
        ) : (
          <span key={r.emoji} className={styles.reaction} title={who} aria-label={label} data-ui="ChatBlock.reactionStatus" data-id={r.emoji}>
            <span aria-hidden>{r.emoji}</span> {r.count}
          </span>
        );
      })}
      {canReact && (
        <div className={styles.reactionPick} ref={pickerRef}>
          <button
            type="button"
            className={styles.addReaction}
            aria-label={t("addReaction")}
            title={t("addReaction")}
            aria-expanded={picking}
            disabled={busy}
            onClick={() => setPicking((open) => !open)}
            data-ui="ChatBlock.addReactionButton"
          >
            <span aria-hidden>☺+</span>
          </button>
          {picking && (
            <div
              className={styles.reactionMenu}
              role="menu"
              aria-label={t("addReaction")}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPicking(false);
              }}
              data-ui="ChatBlock.reactionMenu"
            >
              {CHAT_REACTIONS.map((emoji) => {
                const mine = m.reactions.some((r) => r.emoji === emoji && r.mine);
                return (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={mine}
                    className={styles.reactionChoice}
                    onClick={() => void toggle(emoji, !mine)}
                    data-ui="ChatBlock.reactionItem"
                    data-id={emoji}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A poll under its question: each choice with how many chose it (a bar for
// its share of the voters, the names on hover). While it's open, a click on a
// choice votes for it or takes that back (one choice: picking another moves
// the vote). Its author can close it, for good.
function Poll({
  messageId,
  poll,
  canVote,
  canClose,
  onChanged,
}: {
  messageId: string;
  poll: ChatPollView;
  canVote: boolean;
  canClose: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const [busy, setBusy] = useState(false);
  const mine = poll.options.flatMap((o, i) => (o.mine ? [i] : []));
  const top = Math.max(...poll.options.map((o) => o.count));

  const save = async (action: () => Promise<{ error?: string }>) => {
    if (busy) return;
    setBusy(true);
    const done = beginSaving();
    try {
      const result = await action().catch(() => ({ error: failed }));
      if (result.error) return void (await showAlert(result.error));
      await onChanged();
    } finally {
      done();
      setBusy(false);
    }
  };
  const pick = (i: number) => {
    const chosen = mine.includes(i);
    const next = poll.multiple ? (chosen ? mine.filter((x) => x !== i) : [...mine, i]) : chosen ? [] : [i];
    void save(() => voteChatPoll(messageId, next));
  };
  const close = async () => {
    if (!(await showConfirm(t("pollCloseConfirm"), { confirmLabel: t("pollClose"), danger: true }))) return;
    void save(() => closeChatPoll(messageId));
  };

  return (
    <div
      className={styles.poll}
      role="group"
      aria-label={t("pollLabel")}
      aria-busy={busy || undefined}
      data-ui="ChatBlock.poll"
      data-closed={poll.closed || undefined}
    >
      {poll.options.map((o, i) => {
        const share = poll.voters > 0 ? o.count / poll.voters : 0;
        const label = t("pollChoiceLabel", { text: o.text, count: o.count });
        const who = o.names && o.names.length > 0 ? o.names.join(", ") : undefined;
        const mark = poll.multiple ? (o.mine ? "☑" : "☐") : o.mine ? "◉" : "○";
        const content = (
          <>
            <span className={styles.pollBar} style={{ width: `${share * 100}%` }} aria-hidden />
            {(canVote || o.mine) && (
              <span className={styles.pollMark} aria-hidden>
                {mark}
              </span>
            )}
            <span className={styles.pollText}>{o.text}</span>
            <span className={styles.pollCount} aria-hidden>
              {o.count}
            </span>
          </>
        );
        const common = {
          className: styles.pollOption,
          title: who,
          "data-id": i,
          "data-mine": o.mine || undefined,
          // The most chosen, once it's closed.
          "data-top": (poll.closed && o.count === top && top > 0) || undefined,
        };
        return canVote ? (
          <button
            key={i}
            type="button"
            {...common}
            aria-pressed={o.mine}
            aria-label={label}
            disabled={busy}
            onClick={() => pick(i)}
            data-ui="ChatBlock.pollOptionButton"
          >
            {content}
          </button>
        ) : (
          <div key={i} {...common} aria-label={label} data-ui="ChatBlock.pollOptionRow">
            {content}
          </div>
        );
      })}
      <div className={styles.pollFooter}>
        <span data-ui="ChatBlock.pollStatus">
          {t("pollVoters", { count: poll.voters })}
          {poll.multiple && ` · ${t("pollMultipleNote")}`}
          {poll.closed && ` · ${t("pollClosed")}`}
        </span>
        {canClose && (
          <button type="button" className={styles.linkButton} onClick={() => void close()} disabled={busy} data-ui="ChatBlock.pollCloseButton">
            {t("pollClose")}
          </button>
        )}
      </div>
    </div>
  );
}

// Writing a poll (in place of the message box): the question, the choices
// (Enter goes to the next, making one at the end) and whether more than one
// can be chosen. Empty choices are left out.
function PollComposer({ blockId, onDone, onPosted }: { blockId: string; onDone: () => void; onPosted: () => Promise<void> }) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const { pageId } = usePageEditor();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(() => Array<string>(MIN_POLL_OPTIONS).fill(""));
  const [multiple, setMultiple] = useState(false);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => questionRef.current?.focus({ preventScroll: true }), []);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = !!question.trim() && filled.length >= MIN_POLL_OPTIONS && !sending;
  const focusOption = (i: number) =>
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>(`[data-ui="ChatBlock.pollOptionInput"][data-id="${i}"]`)?.focus());

  const send = async () => {
    if (!ready) return;
    setSending(true);
    const done = beginSaving();
    try {
      const result = await postChatPoll(pageId, blockId, question, filled, multiple).catch(() => ({ error: failed }));
      if (result.error) return void (await showAlert(result.error));
      onDone();
      await onPosted();
    } finally {
      done();
      setSending(false);
    }
  };

  return (
    <form
      ref={formRef}
      className={styles.pollForm}
      aria-label={t("pollFormLabel")}
      data-ui="ChatBlock.pollForm"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) onDone();
      }}
    >
      <div className={styles.pollFormTitle}>
        <Icon name="poll" size={16} className={styles.inlineIcon} /> {t("pollFormLabel")}
      </div>
      <textarea
        ref={questionRef}
        className={styles.pollInput}
        value={question}
        rows={Math.min(4, Math.max(1, question.split("\n").length))}
        maxLength={MAX_CHAT_MESSAGE_LENGTH}
        placeholder={t("pollQuestion")}
        aria-label={t("pollQuestion")}
        disabled={sending}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            focusOption(0);
          }
        }}
        data-ui="ChatBlock.pollQuestionInput"
      />
      {options.map((value, i) => (
        <div key={i} className={styles.pollOptionEdit}>
          <input
            className={styles.pollInput}
            value={value}
            maxLength={MAX_POLL_OPTION_LENGTH}
            placeholder={t("pollOption", { n: i + 1 })}
            aria-label={t("pollOption", { n: i + 1 })}
            disabled={sending}
            onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (i < options.length - 1) focusOption(i + 1);
              else if (options.length < MAX_POLL_OPTIONS && value.trim()) {
                setOptions([...options, ""]);
                focusOption(i + 1);
              }
            }}
            data-ui="ChatBlock.pollOptionInput"
            data-id={i}
          />
          {options.length > MIN_POLL_OPTIONS && (
            <button
              type="button"
              className={styles.linkButton}
              aria-label={t("pollRemoveOption")}
              title={t("pollRemoveOption")}
              disabled={sending}
              onClick={() => setOptions(options.filter((_, j) => j !== i))}
              data-ui="ChatBlock.pollRemoveOptionButton"
              data-id={i}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {options.length < MAX_POLL_OPTIONS && (
        <button
          type="button"
          className={`${styles.linkButton} ${styles.pollAdd}`}
          disabled={sending}
          onClick={() => {
            setOptions([...options, ""]);
            focusOption(options.length);
          }}
          data-ui="ChatBlock.pollAddOptionButton"
        >
          ＋ {t("pollAddOption")}
        </button>
      )}
      <label className={styles.pollCheck}>
        <input
          type="checkbox"
          checked={multiple}
          disabled={sending}
          onChange={(e) => setMultiple(e.target.checked)}
          data-ui="ChatBlock.pollMultipleCheckbox"
        />
        {t("pollMultiple")}
      </label>
      <p className={styles.pollNote}>{t("pollFixedNote")}</p>
      <div className={styles.pollActions}>
        <button type="button" className={styles.linkButton} onClick={onDone} disabled={sending} data-ui="ChatBlock.pollCancelButton">
          {t("pollCancel")}
        </button>
        <button type="submit" className={styles.sendButton} disabled={!ready} data-ui="ChatBlock.pollSubmitButton">
          {t("pollPost")}
        </button>
      </div>
    </form>
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

const FORMAT_KEYS: Record<string, ChatFormat> = { b: "bold", i: "italic", e: "code" };

// The formatting buttons above the message box: each wraps the selection in
// Markdown (or prefixes its lines). The box keeps the focus and the selection.
const FORMATS: { kind: ChatFormat; icon: IconName }[] = [
  { kind: "bold", icon: "bold" },
  { kind: "italic", icon: "italic" },
  { kind: "strike", icon: "strike" },
  { kind: "code", icon: "code" },
  { kind: "link", icon: "link" },
  { kind: "bullet", icon: "bulletList" },
  { kind: "numbered", icon: "numberedList" },
  { kind: "quote", icon: "quote" },
];

function FormatBar({ onFormat, disabled }: { onFormat: (kind: ChatFormat) => void; disabled: boolean }) {
  const t = useTranslations("editor.chat.format");
  return (
    <div className={styles.formatBar} role="toolbar" aria-label={t("label")} data-ui="ChatBlock.formatBar">
      {FORMATS.map(({ kind, icon }) => (
        <button
          key={kind}
          type="button"
          className={styles.formatButton}
          data-kind={kind}
          aria-label={t(kind)}
          title={t(kind)}
          disabled={disabled}
          // Keep the box's selection.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onFormat(kind)}
          data-ui="ChatBlock.formatButton"
          data-id={kind}
        >
          <Icon name={icon} size={18} />
        </button>
      ))}
    </div>
  );
}

// The message box: Enter sends, Shift+Enter starts a new line (not while an
// IME is composing); "@" offers the people who can open the page.
function ChatInput({
  value,
  onValueChange,
  picksRef,
  onFormat,
  onSend,
  onEscape,
  inputRef,
  ...rest
}: {
  value: string;
  onValueChange: (value: string) => void;
  picksRef: { current: Person[] };
  // Ctrl/⌘+B, I, E: bold, italic, code.
  onFormat: (kind: ChatFormat) => void;
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
  // Everyone who can open the page, first (also found by "all").
  const everyone: Person = { id: EVERYONE, name: t("everyone") };
  const matches = (name: string) => name.normalize("NFKC").toLowerCase().includes(q);
  const options =
    at && people && dismissed !== at.start
      ? [...(matches(everyone.name) || EVERYONE.startsWith(q) ? [everyone] : []), ...people.filter((p) => matches(p.name))].slice(0, 8)
      : [];
  const selected = Math.min(active, Math.max(0, options.length - 1));

  // The caret after a chosen name, as soon as the new text is in the box: a
  // key typed before that (it was a frame later) went in at the end, and the
  // caret then moved back before it.
  const placeCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const pos = placeCaret.current;
    const el = ref.current;
    if (pos === null || !el) return;
    placeCaret.current = null;
    el.focus();
    el.setSelectionRange(pos, pos);
  });

  const choose = (p: Person) => {
    if (!at) return;
    const inserted = `@${p.name} `;
    const next = value.slice(0, at.start) + inserted + value.slice(caret);
    if (!picksRef.current.some((x) => x.id === p.id)) picksRef.current = [...picksRef.current, p];
    onValueChange(next);
    const pos = at.start + inserted.length;
    setCaret(pos);
    placeCaret.current = pos;
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
          const shortcut = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? FORMAT_KEYS[e.key.toLowerCase()] : undefined;
          if (shortcut) {
            e.preventDefault();
            onFormat(shortcut);
            return;
          }
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
          // A new line in code (inside ``` fences) keeps the line's indentation.
          if (e.key === "Enter" && e.shiftKey) {
            const el = e.currentTarget;
            const indent = lineIndent(el.value, el.selectionStart);
            if (indent && insideCodeFence(el.value, el.selectionStart)) {
              e.preventDefault();
              el.setRangeText(`\n${indent}`, el.selectionStart, el.selectionEnd, "end");
              onValueChange(el.value);
              setCaret(el.selectionStart);
            }
            return;
          }
          if (e.key === "Enter") {
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
              {p.id === EVERYONE && <span className={styles.mentionHint}>{t("everyoneHint")}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The message box: writes a new message (or a reply), or, with `editing`,
// changes one of the viewer's (a box of its own, in place of the new
// message's, which is hidden meanwhile and keeps what was being written).
function Composer({
  blockId,
  replyTo = null,
  api,
  onCancelReply,
  editing = null,
  onEndEdit,
  hidden = false,
  onPosted,
  onPoll,
}: {
  blockId: string;
  replyTo?: Reply | null;
  // For quoting selected text of a message (in the box, as a Markdown quote).
  api?: Ref<ComposerApi>;
  onCancelReply?: () => void;
  editing?: ChatMessageView | null;
  onEndEdit?: () => void;
  hidden?: boolean;
  onPosted: () => Promise<void>;
  // Starts writing a poll instead (the new message's box only).
  onPoll?: () => void;
}) {
  const t = useTranslations("editor.chat");
  const failed = useTranslations("editor.save")("failed");
  const someone = t("someone");
  const [text, setText] = useState(() => (editing ? toDisplay(editing.text, editing.names, someone) : ""));
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picksRef = useRef<Person[]>(editing ? Object.entries(editing.names).map(([id, name]) => ({ id, name })) : []);
  const { pageId } = usePageEditor();
  // (Not on every refetch while changing a message: its object is new each time.)
  const isEdit = editing !== null;
  useEffect(() => {
    const el = ref.current;
    if (sending || hidden || !el) return;
    el.focus({ preventScroll: true });
    // Changing a message: the caret after its text.
    if (isEdit) el.setSelectionRange(el.value.length, el.value.length);
  }, [sending, hidden, replyTo, isEdit]);

  // A quote asked for: its lines, each with "> ", before what's written.
  useImperativeHandle(api, () => ({
    quote: (selected: string) => {
      const lines = selected.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
      const quoted = `${lines.map((l) => `> ${l}`).join("\n")}\n`;
      setText((current) => quoted + current);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(quoted.length, quoted.length);
      });
    },
  }), []);

  // A formatting button or shortcut: the selection formatted (Markdown),
  // and selected again.
  const format = (kind: ChatFormat) => {
    const el = ref.current;
    if (!el || sending) return;
    const next = applyChatFormat(text, el.selectionStart, el.selectionEnd, kind);
    setText(next.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };

  const send = async () => {
    if (!text.trim() || sending) return;
    const stored = toStored(text, picksRef.current);
    if (editing && stored.trim() === editing.text) return onEndEdit?.();
    setSending(true);
    const done = beginSaving();
    try {
      const result = await (
        editing ? editChatMessage(editing.id, stored) : postChatMessage(pageId, blockId, stored, replyTo?.id ?? null)
      ).catch(() => ({ error: failed }));
      if (result.error) {
        await showAlert(result.error);
        return;
      }
      if (editing) onEndEdit?.();
      else {
        setText("");
        picksRef.current = [];
        onCancelReply?.();
      }
      await onPosted();
    } finally {
      done();
      setSending(false);
    }
  };

  return (
    <form
      className={styles.composerForm}
      hidden={hidden}
      data-ui={editing ? "ChatBlock.editForm" : "ChatBlock.form"}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {editing && (
        <div className={styles.replying} data-ui="ChatBlock.editingStatus">
          <span className={styles.quoteText}>
            <span className={styles.quoteAuthor}>{t("editing")}</span> {excerptOf(editing)}
          </span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={onEndEdit}
            aria-label={t("cancelEdit")}
            title={t("cancelEdit")}
            data-ui="ChatBlock.cancelEditButton"
          >
            ×
          </button>
        </div>
      )}
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
      <FormatBar onFormat={format} disabled={sending} />
      <div className={styles.composer}>
        <ChatInput
          inputRef={ref}
          value={text}
          onValueChange={setText}
          picksRef={picksRef}
          onFormat={format}
          onSend={() => void send()}
          onEscape={editing ? onEndEdit : replyTo ? onCancelReply : undefined}
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          placeholder={editing ? undefined : t("placeholder")}
          aria-label={editing ? t("editLabel") : t("inputLabel")}
          disabled={sending}
          data-ui={editing ? "ChatBlock.editInput" : "ChatBlock.messageInput"}
        />
        {onPoll && !editing && (
          <button
            type="button"
            className={styles.pollButton}
            onClick={onPoll}
            disabled={sending}
            title={t("pollButtonTitle")}
            data-ui="ChatBlock.pollButton"
          >
            <Icon name="poll" size={16} className={styles.inlineIcon} /> {t("pollButton")}
          </button>
        )}
        <button
          type="submit"
          className={styles.sendButton}
          disabled={sending || !text.trim()}
          data-ui={editing ? "ChatBlock.saveButton" : "ChatBlock.sendButton"}
        >
          {editing ? t("save") : t("send")}
        </button>
      </div>
    </form>
  );
}
