// Cells to put on the clipboard as a table: tab-separated text (a cell with
// a tab, a line break or a quote in quotes, as spreadsheets do) and an HTML
// table (for spreadsheets, documents and our own tables' paste). Shared by
// the extended table's column copy and the child page table's cell copy.
// Dependency-free (unit tests: test/clipboard-table.test.ts).

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function tableClipboard(rows: string[][]): { plain: string; html: string } {
  const plain = rows.map((cells) => cells.map((t) => (/[\t\n\r"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)).join("\t")).join("\n");
  const html = `<table>${rows.map((cells) => `<tr>${cells.map((t) => `<td>${escapeHtml(t).replace(/\r?\n/g, "<br>")}</td>`).join("")}</tr>`).join("")}</table>`;
  return { plain, html };
}

// Writes the cells to the clipboard (both forms; the text alone where the
// browser can't write HTML).
export async function copyTable(rows: string[][]): Promise<void> {
  const { plain, html } = tableClipboard(rows);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([plain], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(plain).catch(() => {});
  }
}
