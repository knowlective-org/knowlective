"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { yUndoPluginKey } from "y-prosemirror";
import { filterSuggestionItems } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { getCollabToken, getUploadExtensions } from "@/app/(app)/actions";
import { saveVersionBeforeReplace } from "@/app/(app)/pages/[pageId]/history/actions";
import { getLinkPreviewEnabled, loadLinkPreview } from "@/app/(app)/link-preview-actions";
import { loadChildPages } from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { BASE_PATH, resolveAppUrl, withBasePath } from "@/lib/base-path";
import { CHILDREN_CHANGED, PAGE_DELETED, PAGE_MOVED } from "@/lib/collab-events";
import { EXPORT_MARKDOWN_EVENT, EXPORT_PDF_EVENT, exportFileName } from "@/lib/page-export";
import { beginSaving } from "@/lib/saving-status";
import { MAX_TITLE_LENGTH, TITLE_FIELD, normalizeTitle } from "@/lib/page-title";
import { blockNoteDictionary } from "@/i18n/blocknote";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { isUploadAllowed, uploadRefusedMessage } from "@/lib/upload-types";
import { EditorFormattingToolbar, EditorSideMenu } from "./editor/block-type-menu";
import { docxToHtml } from "./editor/docx-import";
import { singleUrl } from "./editor/link-preview-block";
import { parseVideoUrl } from "./editor/video-url";
import { type ExportBlock, downloadBlob, hasChildPageBlocks, prepareBlocksForExport } from "./editor/markdown-export";
import {
  type ImportKind,
  type ImportedBlock,
  extractMermaid,
  importKind,
  mermaidFromCodeBlock,
  prepareImportedBlocks,
  readTextFile,
  splitMarkdownTitle,
  textToBlocks,
} from "./editor/markdown-import";
import { PageEditorContext, type PageEditorContextValue } from "./editor/page-context";
import { customSlashMenuItems, editorSchema } from "./editor/schema";
import { showAlert, showChoice, showConfirm } from "./dialog";
import { EditorPlaceholder } from "./editor-placeholder";
import styles from "./collaborative-editor.module.css";

// The viewer's text for the helpers below, which BlockNote calls outside
// React (uploads, imports). Set by EditorBody; a browser shows one language.
type Text = ReturnType<typeof useTranslations<never>>;
let text: Text;

const CURSOR_COLORS = ["#5b8def", "#e5484d", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f"];

// The collaboration WebSocket is served by the same process and origin as the
// app (server/collab.ts, COLLAB_PATH), so no separate URL needs configuring.
function collabUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${withBasePath("/collab")}`;
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
  const [failure, setFailure] = useState<"openFailed" | "movedToTrash" | null>(null);
  const t = useTranslations("editor");

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
          setFailure("openFailed");
          return;
        }
        retryTimer = setTimeout(() => setAttempt((n) => n + 1), delay);
      },
      onStateless: ({ payload }) => {
        try {
          const type = (JSON.parse(payload) as { type?: string }).type;
          if (type === PAGE_DELETED) {
            setFailure("movedToTrash");
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

  if (failure) return <EditorPlaceholder message={t(failure)} />;
  if (!provider || synced !== provider) return <EditorPlaceholder />;
  return <EditorBody {...props} provider={provider} />;
}

// BlockNote calls this for dropped/pasted files and the file blocks' upload
// button; the returned URL becomes the block's src (served with a membership
// check by /api/files/<id>).
async function uploadFile(pageId: string, file: File): Promise<string> {
  try {
    return await postFile(pageId, file);
  } catch (error) {
    void showAlert((error as Error).message, { title: text("editor.uploadFailedTitle") });
    throw error;
  }
}

class UploadError extends Error {}

// Stores a file as an attachment of the page and returns its URL.
async function postFile(pageId: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(withBasePath(`/api/files?pageId=${encodeURIComponent(pageId)}`), { method: "POST", body });
  const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !data?.url) throw new UploadError(data?.error ?? text("editor.uploadFailed"));
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

// The editor methods the paste / import helpers use, loosely typed: they
// build blocks from parsed data rather than from literals.
type BlockEditor = {
  document: unknown;
  getBlock: (id: string) => unknown;
  getTextCursorPosition: () => { block: { id: string; type: string; content?: unknown } };
  insertBlocks: (blocks: never[], reference: string, placement: "before" | "after") => unknown;
  replaceBlocks: (remove: string[], insert: never[]) => unknown;
  removeBlocks: (remove: string[]) => unknown;
  updateBlock: (id: string, update: never) => unknown;
  tryParseMarkdownToBlocks: (markdown: string) => unknown;
  tryParseHTMLToBlocks: (html: string) => unknown;
};

// Pasted Markdown with ```mermaid fences arrives as code blocks; turn the
// ones this paste brought in into diagrams.
function convertPastedMermaid(editor: BlockEditor, before: Map<string, string>) {
  const walk = (blocks: AnyBlock[]) => {
    for (const block of blocks) {
      const diagram = before.get(block.id) === "codeBlock:" ? null : mermaidFromCodeBlock(block);
      if (diagram) editor.replaceBlocks([block.id], [diagram as never]);
      else walk(block.children);
    }
  };
  walk(editor.document as AnyBlock[]);
}

// Pasting Mermaid source on its own makes a diagram: into the current line if
// it's empty, otherwise below it.
function insertMermaid(editor: BlockEditor, code: string) {
  const diagram = { type: "mermaid", props: { code } } as never;
  const current = editor.getTextCursorPosition().block;
  if (Array.isArray(current.content) && current.content.length === 0) editor.updateBlock(current.id, diagram);
  else editor.insertBlocks([diagram], current.id, "after");
}

// Whether the administrators have link previews on (/admin). Asked when an
// editor opens; until the answer arrives a pasted URL stays a plain link, so
// nothing is fetched that shouldn't be.
let linkPreviewEnabled = false;

// A URL pasted into an empty line becomes a link preview card. The card
// shows the URL at once; its title, description and image are filled in when
// the server has fetched them (if it can). Returns false when the cursor
// isn't on an empty paragraph: the URL is then pasted as an ordinary link.
function insertLinkPreview(editor: BlockEditor, url: string): boolean {
  if (!linkPreviewEnabled) return false;
  const current = editor.getTextCursorPosition().block;
  if (current.type !== "paragraph" || !Array.isArray(current.content) || current.content.length > 0) return false;
  editor.updateBlock(current.id, { type: "linkPreview", props: { url } } as never);
  void loadLinkPreview(url)
    .then((preview) => {
      if (!preview || !editor.getBlock(current.id)) return;
      const { title, description, image, siteName } = preview;
      editor.updateBlock(current.id, { props: { title, description, image, siteName } } as never);
    })
    .catch(() => {
      // The card stays as it is, with the URL.
    });
  return true;
}

// A video's URL pasted into an empty line becomes a player: the site's own
// for YouTube, Vimeo and Niconico, the browser's for a link to a video file.
// Returns false for other URLs, and when the cursor isn't on an empty
// paragraph.
function insertVideo(editor: BlockEditor, url: string): boolean {
  const source = parseVideoUrl(url);
  if (!source) return false;
  const current = editor.getTextCursorPosition().block;
  if (current.type !== "paragraph" || !Array.isArray(current.content) || current.content.length > 0) return false;
  const block = source.kind === "embed" ? { type: "videoEmbed", props: { url } } : { type: "video", props: { url } };
  editor.updateBlock(current.id, block as never);
  return true;
}

// For an uploadFile that ends without a file: BlockNote updates the file
// block it has just created (`blockId`) with what uploadFile returns (nothing,
// here) right after it resolves; remove the block once it has.
function discardFileBlock(editor: BlockEditor, blockId: string): Record<string, never> {
  setTimeout(() => {
    if (editor.getBlock(blockId)) editor.removeBlocks([blockId]);
  }, 0);
  return {};
}

// Adds the content of a Markdown, text or Word file to the page, in place of
// the file block BlockNote has just created for it (`blockId`).
async function expandFile(
  editor: BlockEditor,
  pageId: string,
  file: File,
  kind: ImportKind,
  blockId: string,
): Promise<Record<string, never>> {
  let blocks: ImportedBlock[];
  let skippedImages = 0;
  if (kind === "docx") {
    try {
      // The document's images become attachments of the page.
      const result = await docxToHtml(file, (image) => postFile(pageId, image));
      blocks = prepareImportedBlocks(editor.tryParseHTMLToBlocks(result.html) as ImportedBlock[]);
      skippedImages = result.skippedImages;
    } catch (error) {
      void showAlert(
        error instanceof UploadError
          ? text("editor.expandImageFailed", { message: error.message })
          : text("editor.expandWordFailed"),
        { title: text("editor.expandFailedTitle") },
      );
      return discardFileBlock(editor, blockId);
    }
  } else {
    const text = await readTextFile(file);
    blocks =
      kind === "markdown"
        ? prepareImportedBlocks(editor.tryParseMarkdownToBlocks(text) as ImportedBlock[])
        : textToBlocks(text);
  }
  if (!editor.getBlock(blockId)) return {};
  if (blocks.length > 0) editor.insertBlocks(blocks as never[], blockId, "after");
  if (skippedImages > 0) {
    void showAlert(text("editor.skippedImages", { count: skippedImages }), {
      title: text("editor.skippedImagesTitle"),
    });
  }
  return discardFileBlock(editor, blockId);
}

// Replaces the whole page, title and body, with a Markdown file (the title
// from its leading "# heading", or the file name). The current state goes
// into the page history first, so the replacement can be undone there;
// nothing is replaced if that fails.
async function replacePage(
  provider: HocuspocusProvider,
  editor: BlockEditor,
  pageId: string,
  file: File,
  blockId: string,
): Promise<Record<string, never>> {
  const confirmed = await showConfirm(text("editor.replaceConfirm", { name: file.name }), {
    title: text("editor.replaceConfirmTitle"),
    confirmLabel: text("editor.replace"),
    danger: true,
  });
  if (!confirmed) return discardFileBlock(editor, blockId);
  const saved = await saveVersionBeforeReplace(pageId).catch(() => ({ error: text("editor.replaceErrors.failed") }));
  if (saved.error) {
    void showAlert(saved.error, { title: text("editor.replaceFailedTitle") });
    return discardFileBlock(editor, blockId);
  }
  const { title, body } = splitMarkdownTitle(await readTextFile(file), file.name);
  const parsed = prepareImportedBlocks(editor.tryParseMarkdownToBlocks(body) as ImportedBlock[]);
  if (!editor.getBlock(blockId)) return {};
  // Done right after BlockNote has updated the file block with the return
  // value (as in discardFileBlock), since the file block goes too. An empty
  // file leaves an empty line: a page always has a block.
  setTimeout(() => {
    const all = (editor.document as AnyBlock[]).map((block) => block.id);
    editor.replaceBlocks(all, (parsed.length > 0 ? parsed : [{ type: "paragraph" }]) as never[]);
    const ytitle = provider.document.getText(TITLE_FIELD);
    provider.document.transact(() => {
      ytitle.delete(0, ytitle.length);
      ytitle.insert(0, normalizeTitle(title));
    });
  }, 0);
  return {};
}

// The editor of each connection, for uploadFile: it's set up before the
// editor exists.
const editors = new WeakMap<object, BlockEditor>();

function isPdfFile(file: File): boolean {
  return /\.pdf$/i.test(file.name) || file.type === "application/pdf";
}

// A PDF is attached either way; the choice is how it's shown. Returns what
// BlockNote updates the file block it has just created (`blockId`) with.
async function attachOrEmbedPdf(editor: BlockEditor, pageId: string, file: File, blockId: string) {
  const choice = await showChoice(
    text("editor.pdfChoice", { name: file.name }),
    [
      { value: "attach", label: text("editor.attach") },
      { value: "embed", label: text("editor.embedPages") },
    ],
    { title: text("editor.pdfChoiceTitle") },
  );
  if (choice === null) return discardFileBlock(editor, blockId);
  const url = await uploadFile(pageId, file);
  return choice === "embed" ? { type: "pdf", props: { url, name: file.name } } : url;
}

// A Markdown, text or Word file (dropped, pasted, or chosen in a file block)
// can be attached like any other file or expanded into the page (a Markdown
// file can also replace the whole page), and a PDF attached or shown page by
// page; the user chooses.
//
// A file of a type the administrators don't allow (/admin/files) is refused
// first, expanding included. If the list can't be fetched, the upload route
// still refuses the file.
async function expandOrUpload(provider: HocuspocusProvider, pageId: string, file: File, blockId?: string) {
  const editor = editors.get(provider);
  const allowed = await getUploadExtensions().catch(() => []);
  if (!isUploadAllowed(file.name, allowed)) {
    const message = uploadRefusedMessage(file.name, (key, values) => text(`files.errors.${key}`, values));
    void showAlert(message, { title: text("editor.refusedTitle") });
    if (editor && blockId) return discardFileBlock(editor, blockId);
    throw new Error(message);
  }
  if (editor && blockId && isPdfFile(file)) return attachOrEmbedPdf(editor, pageId, file, blockId);
  const kind = importKind(file);
  if (!editor || !blockId || !kind) {
    return uploadFile(pageId, file);
  }
  const choice = await showChoice(
    text("editor.expandChoice", { name: file.name }) + (kind === "docx" ? text("editor.expandDocxNote") : ""),
    [
      { value: "attach", label: text("editor.attach") },
      // Markdown only: its leading heading can be the title.
      ...(kind === "markdown" ? [{ value: "replace" as const, label: text("editor.replacePage") }] : []),
      { value: "expand", label: text("editor.expand") },
    ],
    { title: text(`editor.importTitles.${kind}`) },
  );
  if (choice === "attach") return uploadFile(pageId, file);
  if (choice === "expand") return expandFile(editor, pageId, file, kind, blockId);
  if (choice === "replace") return replacePage(provider, editor, pageId, file, blockId);
  return discardFileBlock(editor, blockId);
}

// BlockNote's uploadFile. When adding the file fails (the upload is refused or
// breaks; uploadFile has already said why), the file block BlockNote created
// for it is removed: left in place it has a name but no file, and shows
// "Loading…" forever.
async function addFile(provider: HocuspocusProvider, pageId: string, file: File, blockId?: string) {
  try {
    return await expandOrUpload(provider, pageId, file, blockId);
  } catch (error) {
    const editor = editors.get(provider);
    if (!editor || !blockId) throw error;
    console.error("[editor] adding a file failed", error);
    return discardFileBlock(editor, blockId);
  }
}

function EditorBody({
  pageId,
  readOnly,
  user,
  onTitleChange,
  provider,
}: Props & { provider: HocuspocusProvider }) {
  const locale = useLocale();
  const t = useTranslations();
  text = t;
  const displayTitle = useDisplayTitle();
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: editorSchema,
      dictionary: blockNoteDictionary(locale),
      // Headings pasted from outside knowlective (HTML or Markdown) move down one
      // level — H1→H2 … H5→H6, H6 stays — keeping their relative structure
      // under the page title. Copy and paste within knowlective (blocknote/html)
      // keeps the levels as they are.
      pasteHandler: ({ event, editor, defaultPasteHandler }) => {
        const types = event.clipboardData?.types ?? [];
        if (types.includes("blocknote/html")) return defaultPasteHandler();
        const blockEditor = editor as unknown as BlockEditor;
        // Mermaid source on its own becomes a diagram (not inside a code
        // block, where it's meant as code).
        if (!types.includes("Files") && blockEditor.getTextCursorPosition().block.type !== "codeBlock") {
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const mermaid = extractMermaid(text);
          if (mermaid !== null) {
            insertMermaid(blockEditor, mermaid);
            return true;
          }
          // A URL on its own, pasted into an empty line, becomes a preview card.
          // (A video's URL becomes a player instead.)
          const url = singleUrl(text);
          if (url && (insertVideo(blockEditor, url) || insertLinkPreview(blockEditor, url))) return true;
        }
        const before = blockKinds(editor.document as AnyBlock[]);
        pasting.add(editor);
        try {
          return defaultPasteHandler();
        } finally {
          pasting.delete(editor);
          shiftPastedHeadings(editor, before);
          convertPastedMermaid(blockEditor, before);
        }
      },
      // Guests can't add files; without uploadFile BlockNote ignores drops.
      // For Markdown, text and Word files, expandOrUpload asks whether to attach or expand.
      // Files are stored as "/api/files/<id>", without the base path.
      resolveFileUrl: async (url: string) => resolveAppUrl(url),
      uploadFile: readOnly
        ? undefined
        : (file: File, blockId?: string) =>
            addFile(provider, pageId, file, blockId),
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
    [provider, locale],
  );
  useEffect(() => {
    editors.set(provider, editor as unknown as BlockEditor);
  }, [editor, provider]);

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

  useEffect(() => {
    if (readOnly) return;
    void getLinkPreviewEnabled()
      .then((enabled) => {
        linkPreviewEnabled = enabled;
      })
      .catch(() => {
        linkPreviewEnabled = false;
      });
  }, [readOnly]);

  // The saving mark at the top of the page: while this connection has changes the
  // server hasn't acknowledged (typing, or offline with edits waiting).
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

  // Markdown and PDF export, asked for from the page menu (lib/page-export.ts).
  // Shown while a PDF is being built: the first one downloads the compiler
  // and the fonts, which takes a while.
  const [exportingPdf, setExportingPdf] = useState(false);
  useEffect(() => {
    let busy = false;
    const run = async (format: "md" | "pdf") => {
      if (busy) return;
      busy = true;
      if (format === "pdf") setExportingPdf(true);
      try {
        const blocks = editor.document as ExportBlock[];
        const childPages = hasChildPageBlocks(blocks) ? await loadChildPages(pageId) : null;
        const title = displayTitle(provider.document.getText(TITLE_FIELD).toString());
        const prepared = prepareBlocksForExport(blocks, {
          // Links in the export are full URLs, base path included.
          origin: window.location.origin + BASE_PATH,
          pageId,
          childPages,
          untitled: t("common.untitled"),
          mermaid: format === "pdf" ? "keep" : "code",
        });
        if (format === "md") {
          const body = editor.blocksToMarkdownLossy(prepared as never[]);
          const markdown = new Blob([`# ${title}\n\n${body}`], { type: "text/markdown;charset=utf-8" });
          downloadBlob(exportFileName(title, "md"), markdown);
        } else {
          // Loaded on demand: the exporter isn't part of the editor's code.
          const { exportPdf } = await import("./editor/pdf-export");
          downloadBlob(exportFileName(title, "pdf"), await exportPdf(editorSchema, prepared, title, { lang: locale, mermaidAlt: t("editor.mermaidAlt") }));
        }
      } catch (error) {
        console.error(`[export] ${format} failed`, error);
        void showAlert(t("editor.exportFailed", { format: format === "pdf" ? "PDF" : "Markdown" }), {
          title: t("editor.exportFailedTitle"),
        });
      } finally {
        busy = false;
        setExportingPdf(false);
      }
    };
    const onMarkdown = () => void run("md");
    const onPdf = () => void run("pdf");
    window.addEventListener(EXPORT_MARKDOWN_EVENT, onMarkdown);
    window.addEventListener(EXPORT_PDF_EVENT, onPdf);
    return () => {
      window.removeEventListener(EXPORT_MARKDOWN_EVENT, onMarkdown);
      window.removeEventListener(EXPORT_PDF_EVENT, onPdf);
    };
  }, [editor, provider, pageId]);

  return (
    <>
      <TitleField
        ytext={provider.document.getText(TITLE_FIELD)}
        readOnly={readOnly}
        onChange={onTitleChange}
        onEnter={() => editor.focus()}
      />
      <PageEditorContext.Provider value={pageContext}>
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme="light"
          slashMenu={false}
          sideMenu={false}
          formattingToolbar={false}
          data-ui="EditorBody.editor"
        >
          <EditorFormattingToolbar />
          <EditorSideMenu />
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...customSlashMenuItems(editor, t)], query)
            }
          />
        </BlockNoteView>
      </PageEditorContext.Provider>
      {exportingPdf && (
        <p className={styles.exportStatus} role="status" data-ui="EditorBody.status">
          {t("editor.makingPdf")}
        </p>
      )}
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
  const t = useTranslations();
  const displayTitle = useDisplayTitle();

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
    document.title = `${displayTitle(value)} | KNOWLECTIVE`;
    // Grow with the text instead of scrolling inside the field.
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value, onChange]);

  return (
    <>
    {/* Printed instead of the field, whose height is fitted to the screen's width. */}
    <div className={styles.printTitle} aria-hidden>
      {displayTitle(value)}
    </div>
    <textarea
      ref={ref}
      className={styles.title}
      data-ui="TitleField"
      value={value}
      placeholder={t("common.untitled")}
      readOnly={readOnly}
      rows={1}
      maxLength={MAX_TITLE_LENGTH}
      aria-label={t("editor.titleLabel")}
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
    </>
  );
}
