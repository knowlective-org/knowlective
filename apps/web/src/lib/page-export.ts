// Page export, asked for from the page menu and done by the editor (which
// holds the page's content). They're separate components — the editor is
// loaded on its own — so the request is a window event. No dependencies.

export const EXPORT_MARKDOWN_EVENT = "knowlective:export-markdown";
export const EXPORT_PDF_EVENT = "knowlective:export-pdf";

// A page title as a file name: without the characters Windows, macOS or
// Linux refuse.
export function exportFileName(title: string, extension: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/^\.+/, "").slice(0, 100);
  return `${base || "page"}.${extension}`;
}
