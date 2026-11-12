"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { yUndoPluginKey } from "y-prosemirror";
import { combineByGroup, filterSuggestionItems } from "@blocknote/core";
import { getMultiColumnSlashMenuItems, multiColumnDropCursor } from "@blocknote/xl-multi-column";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { getUploadPolicy } from "@/app/(app)/actions";
import { lockedBlockIds } from "@/lib/block-locks";
import { saveVersionBeforeReplace } from "@/app/(app)/pages/[pageId]/history/actions";
import { getLinkPreviewEnabled, loadLinkPreview } from "@/app/(app)/link-preview-actions";
import { loadChildPages } from "@/app/(app)/pages/[pageId]/child-pages-actions";
import { BASE_PATH, resolveAppUrl } from "@/lib/base-path";
import { sameSitePath } from "@/lib/same-site-link";
import { UploadError, postFile as postSharedFile } from "@/lib/upload-file";
import { CHILDREN_CHANGED } from "@/lib/collab-events";
import { EXPORT_MARKDOWN_EVENT, EXPORT_PDF_EVENT, exportFileName } from "@/lib/page-export";
import { beginSaving } from "@/lib/saving-status";
import { TITLE_FIELD, normalizeTitle } from "@/lib/page-title";
import { blockNoteDictionary } from "@/i18n/blocknote";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { isUploadAllowed, uploadRefusedMessage } from "@/lib/upload-types";
import { EditorFormattingToolbar, EditorSideMenu } from "./editor/block-type-menu";
import { useAdoptFiles } from "./editor/adopt-files";
import { dragCopyExtension } from "./editor/drag-copy";
import { docxToHtml } from "./editor/docx-import";
import { MAX_PDF_IMPORT_PAGES, PdfPasswordError, readPdfBlocks } from "./editor/pdf-import";
import { type PdfBlock, pdfTitle } from "./editor/pdf-text";
import { singleUrl } from "./editor/link-preview-block";
import { parseVideoUrl } from "./editor/video-url";
import { type ExportBlock, downloadBlob, hasChildPageBlocks, prepareBlocksForExport } from "./editor/markdown-export";
import { MAX_CSV_COLUMNS, MAX_CSV_ROWS, csvToTable } from "./editor/csv-import";
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
import { PageProperties } from "./editor/page-properties";
import { customSlashMenuItems, editorSchema, mentionMenuItems, withTodoForChecklist } from "./editor/schema";
import { pagePeople } from "./editor/page-people";
import { useFilePaths } from "./editor/file-paths";
import { showAlert, showChoice, showConfirm } from "./dialog";
import { CollabConnection } from "./collab-connection";
import { TitleField } from "./title-field";
import { blockLockExtension } from "./editor/block-lock";
import { showNotice } from "./notice";
import styles from "./collaborative-editor.module.css";
import { cursorColorFor } from "@/lib/cursor-color";

// The viewer's text for the helpers below, which BlockNote calls outside
// React (uploads, imports). Set by EditorBody; a browser shows one language.
type Text = ReturnType<typeof useTranslations<never>>;
let text: Text;



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

// Connects to the collaboration server (CollabConnection) and syncs the
// page's title and BlockNote body over Yjs.
export function CollaborativeEditor(props: Props) {
  return <CollabConnection pageId={props.pageId}>{(provider) => <EditorBody {...props} provider={provider} />}</CollabConnection>;
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

// Stores a file as an attachment of the page and returns its URL.
const postFile = (pageId: string, file: File) => postSharedFile(pageId, file, text("editor.uploadFailed"));

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

// Check list items a paste brought in ("- [ ] …" in Markdown, checkboxes in
// HTML) become TODOs, which replace the check list.
function convertPastedChecklists(editor: BlockEditor, before: Map<string, string>) {
  const walk = (blocks: AnyBlock[]) => {
    for (const block of blocks) {
      if (block.type === "checkListItem" && before.get(block.id) !== "checkListItem:") {
        editor.updateBlock(block.id, { type: "todo", props: { checked: block.props.checked === true } } as never);
      }
      walk(block.children);
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

// Adds the content of a Markdown, text, Word or CSV file (a table) to the page, in place of
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
  } else if (kind === "csv") {
    const table = csvToTable(await readTextFile(file), file.name);
    if (!table) {
      void showAlert(text("editor.expandCsvEmpty"), { title: text("editor.expandFailedTitle") });
      return discardFileBlock(editor, blockId);
    }
    if (table.truncated) void showAlert(text("editor.expandCsvTruncated", { rows: MAX_CSV_ROWS, columns: MAX_CSV_COLUMNS }));
    blocks = [table.block as ImportedBlock];
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
  // The title and blocks (a PDF's); a Markdown file's otherwise.
  content?: () => Promise<{ title: string; blocks: ImportedBlock[] } | null>,
): Promise<Record<string, never>> {
  // Every block would go, and locked ones can't (block-lock.ts).
  if (lockedBlockIds(provider.document).size > 0) {
    void showAlert(text("editor.replaceLocked"), { title: text("editor.replaceFailedTitle") });
    return discardFileBlock(editor, blockId);
  }
  const confirmed = await showConfirm(text(content ? "editor.replaceConfirmPdf" : "editor.replaceConfirm", { name: file.name }), {
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
  let title: string;
  let parsed: ImportedBlock[];
  if (content) {
    const read = await content();
    if (!read) return discardFileBlock(editor, blockId);
    ({ title, blocks: parsed } = read);
  } else {
    const split = splitMarkdownTitle(await readTextFile(file), file.name);
    title = split.title;
    parsed = prepareImportedBlocks(editor.tryParseMarkdownToBlocks(split.body) as ImportedBlock[]);
  }
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

// A PDF: attached as a file, attached and shown page by page, or its text
// expanded into the page or put in place of the page (read in the browser,
// pdf-import.ts; nothing is uploaded for those two, so they're what's left
// when adding files is turned off). Returns what BlockNote updates the file
// block it has just created (`blockId`) with.
async function attachOrEmbedPdf(
  provider: HocuspocusProvider,
  editor: BlockEditor,
  pageId: string,
  file: File,
  blockId: string,
  uploads: boolean,
) {
  const choice = await showChoice(
    text(uploads ? "editor.pdfChoice" : "editor.pdfChoiceNoUpload", { name: file.name }) + text("editor.pdfExpandNote"),
    // The last is the suggested one: page by page, as before (expanding when
    // nothing can be uploaded).
    [
      { value: "replace" as const, label: text("editor.replacePage") },
      ...(uploads ? [{ value: "attach" as const, label: text("editor.attach") }] : []),
      { value: "expand" as const, label: text("editor.expand") },
      ...(uploads ? [{ value: "embed" as const, label: text("editor.embedPages") }] : []),
    ],
    { title: text("editor.pdfChoiceTitle") },
  );
  if (choice === null) return discardFileBlock(editor, blockId);
  if (choice === "expand") {
    const blocks = await pdfBlocksOf(file);
    if (!blocks) return discardFileBlock(editor, blockId);
    if (editor.getBlock(blockId)) editor.insertBlocks(blocks as never[], blockId, "after");
    return discardFileBlock(editor, blockId);
  }
  if (choice === "replace") {
    return replacePage(provider, editor, pageId, file, blockId, async () => {
      const blocks = await pdfBlocksOf(file);
      return blocks ? pdfTitle(blocks, file.name) : null;
    });
  }
  const url = await uploadFile(pageId, file);
  return choice === "embed" ? { type: "pdf", props: { url, name: file.name } } : url;
}

// A PDF's text as blocks, or null (and why, said) when there's none to take.
async function pdfBlocksOf(file: File): Promise<PdfBlock[] | null> {
  const title = { title: text("editor.expandFailedTitle") };
  try {
    const { blocks, truncated } = await readPdfBlocks(file);
    if (blocks.length === 0) {
      void showAlert(text("editor.expandPdfNoText"), title);
      return null;
    }
    if (truncated) void showAlert(text("editor.expandPdfTruncated", { count: MAX_PDF_IMPORT_PAGES }));
    return blocks;
  } catch (error) {
    console.error("[editor] reading a PDF failed", error);
    void showAlert(text(error instanceof PdfPasswordError ? "editor.expandPdfPassword" : "editor.expandPdfFailed"), title);
    return null;
  }
}

// A Markdown, text, Word or CSV file (dropped, pasted, or chosen in a file block)
// can be attached like any other file or expanded into the page (a Markdown
// file can also replace the whole page), and a PDF attached or shown page by
// page; the user chooses.
//
// A file of a type the administrators don't allow (/admin/files) is refused
// first, expanding included. With files turned off there (no uploads at
// all), Markdown and text files can still be expanded (nothing is uploaded);
// any other file is refused. If the settings can't be fetched, the upload
// route still refuses the file.
async function expandOrUpload(provider: HocuspocusProvider, pageId: string, file: File, blockId?: string) {
  const editor = editors.get(provider);
  const policy = await getUploadPolicy().catch(() => ({ enabled: true, extensions: [] as string[] }));
  const kind = importKind(file);
  const refuse = (message: string) => {
    void showAlert(message, { title: text("editor.refusedTitle") });
    if (editor && blockId) return discardFileBlock(editor, blockId);
    throw new Error(message);
  };
  if (!policy.enabled && !(editor && blockId && (kind === "markdown" || kind === "text" || kind === "csv" || isPdfFile(file)))) {
    return refuse(text("files.errors.disabled"));
  }
  if (!isUploadAllowed(file.name, policy.extensions)) {
    return refuse(uploadRefusedMessage(file.name, (key, values) => text(`files.errors.${key}`, values)));
  }
  if (editor && blockId && isPdfFile(file)) return attachOrEmbedPdf(provider, editor, pageId, file, blockId, policy.enabled);
  if (!editor || !blockId || !kind) {
    return uploadFile(pageId, file);
  }
  const choice = await showChoice(
    text("editor.expandChoice", { name: file.name }) +
      (kind === "docx" ? text("editor.expandDocxNote") : kind === "csv" ? text("editor.expandCsvNote") : ""),
    [
      ...(policy.enabled ? [{ value: "attach" as const, label: text("editor.attach") }] : []),
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
  // For the helpers outside React; set after rendering (not during it). They
  // only run on user actions, which come after this.
  useEffect(() => {
    text = t;
  }, [t]);
  const displayTitle = useDisplayTitle();
  const router = useRouter();
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: editorSchema,
      // A link clicked in the text: one to this site opens in this tab
      // (components/same-tab-links.tsx does the same outside the editor),
      // others in a new one, as BlockNote's own.
      links: {
        onClick: (event) => {
          const link = (event.target as Element | null)?.closest?.("a[href]");
          if (!(link instanceof HTMLAnchorElement)) return false;
          const path = sameSitePath(link.href, window.location.origin, BASE_PATH);
          if (path !== null && !event.ctrlKey && !event.metaKey && !event.shiftKey) router.push(path);
          else window.open(link.href, "_blank", "noopener,noreferrer");
          return true;
        },
      },
      extensions: [
        // Ctrl-dragging a block copies it, dropped in the margins too.
        dragCopyExtension(),
        blockLockExtension(provider.document, {
          // Labels are drawn as the editor is made, before `text` is set.
          label: (lock) => t(lock === "edit" ? "editor.blockLock.editLabel" : "editor.blockLock.deleteLabel"),
          blocked: (lock) => showNotice(t(lock === "edit" ? "editor.blockLock.editBlocked" : "editor.blockLock.deleteBlocked")),
        }),
      ],
      dictionary: blockNoteDictionary(locale),
      // Dropping a block at another's left or right edge puts them in columns.
      dropCursor: multiColumnDropCursor,
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
          convertPastedChecklists(blockEditor, before);
        }
      },
      // Guests can't add files; without uploadFile BlockNote ignores drops.
      // For Markdown, text, Word and CSV files, expandOrUpload asks whether to attach or expand.
      // Files are stored as "/api/files/<id>", without the base path.
      resolveFileUrl: async (url: string) => resolveAppUrl(url),
      uploadFile: readOnly
        ? undefined
        : (file: File, blockId?: string) =>
            addFile(provider, pageId, file, blockId),
      collaboration: {
        fragment: provider.document.getXmlFragment("blocknote"),
        // The server sets every cursor's name and color from who is logged in
        // (server/collab.ts); these match it.
        user: { name: user.name, color: cursorColorFor(user.id) },
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

  // Attachments of blocks copied from other pages become this page's own.
  useAdoptFiles(editor, provider, pageId, readOnly, (names) =>
    showConfirm(text("editor.adoptFilesConfirm", { names: names.join("\n") }), {
      title: text("editor.adoptFilesTitle"),
      confirmLabel: text("editor.adoptFilesCopy"),
    }),
  );

  // A click on a file path in the text copies it (a browser won't open it).
  useFilePaths(editor);

  // Files dropped outside the blocks (the title, the margins, below the last
  // block) go at the end of the page, the way a paste does: BlockNote only
  // takes a drop onto a block, and otherwise the browser would open the file
  // in place of the page. A Markdown or text file still offers to be expanded.
  useEffect(() => {
    if (readOnly) return;
    const view = () => editor.prosemirrorView;
    const outsideBlocks = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return false;
      const target = e.target as Element | null;
      if (!target?.closest("main")) return false;
      const dom = editor.domElement;
      if (!dom?.contains(target)) return true;
      return !view()?.posAtCoords({ left: e.clientX, top: e.clientY });
    };
    const onDragOver = (e: DragEvent) => {
      if (!outsideBlocks(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!outsideBlocks(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const files = new DataTransfer();
      for (const file of Array.from(e.dataTransfer!.files)) files.items.add(file);
      if (files.items.length === 0) return;
      // An empty last paragraph takes the file; otherwise a new one after the last block.
      const blocks = editor.document;
      const last = blocks[blocks.length - 1];
      const emptyParagraph =
        last.type === "paragraph" && Array.isArray(last.content) && last.content.length === 0 && last.children.length === 0;
      const target = emptyParagraph ? last : editor.insertBlocks([{ type: "paragraph" }], last, "after")[0];
      editor.setTextCursorPosition(target, "end");
      editor.domElement?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: files, bubbles: true, cancelable: true }),
      );
    };
    // Capture: ahead of BlockNote's own drop handling on the editor.
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
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
      userId: user.id,
      onChildrenChanged(listener) {
        events.addEventListener(CHILDREN_CHANGED, listener);
        return () => events.removeEventListener(CHILDREN_CHANGED, listener);
      },
    }),
    [pageId, user.id, events],
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
          people: Object.fromEntries(((await pagePeople(pageId)) ?? []).map((p) => [p.id, p.name])),
          whiteboard: t("editor.slash.whiteboard"),
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
        <PageProperties />
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
              filterSuggestionItems(
                combineByGroup(
                  withTodoForChecklist(getDefaultReactSlashMenuItems(editor), editor, t),
                  getMultiColumnSlashMenuItems(editor),
                  // Ours join BlockNote's group of the same name ("Others").
                  customSlashMenuItems(editor, t),
                ),
                query,
              )
            }
          />
          {/* "@": mention someone who can open the page. */}
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (query) => mentionMenuItems(editor, (await pagePeople(pageId)) ?? [], query)}
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
