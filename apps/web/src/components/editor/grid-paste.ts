// Table data pasted into a cell of the extended table (grid-table-block.ts
// pasteIntoGrid()): the cells' texts, row by row. From the clipboard's text
// when it's tab-separated (what spreadsheets put there, besides an HTML
// table): a line per row, a tab between cells, quoted cells ("…", with ""
// for a quote) holding tabs and line breaks. Plain text without a tab isn't a
// table (it's pasted as text).
//
// Dependency-free: unit-tested (test/grid-paste.test.ts). Also the child
// page table's paste (child-table-block.tsx).

export function tableFromTsv(text: string): string[][] | null {
  const source = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!source.includes("\t")) return null;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return trimTable(rows);
}

// Without empty rows and columns at the end; null when nothing's left.
export function trimTable(rows: string[][]): string[][] | null {
  const out = rows.map((r) => [...r]);
  while (out.length > 0 && out[out.length - 1].every((c) => c.trim() === "")) out.pop();
  const width = Math.max(0, ...out.map((r) => {
    let w = r.length;
    while (w > 0 && r[w - 1].trim() === "") w--;
    return w;
  }));
  if (out.length === 0 || width === 0) return null;
  return out.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

// The table data on the clipboard, if any: an HTML table (what spreadsheets
// and other editors put there) or tab-separated text.
export function clipboardTable(data: DataTransfer): string[][] | null {
  const html = data.getData("text/html");
  if (html && /<table[\s>]/i.test(html)) {
    const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
    if (table) {
      const rows = [...table.querySelectorAll("tr")].map((tr) =>
        [...tr.querySelectorAll("th, td")].map((cell) => {
          // Line breaks and paragraphs as lines.
          cell.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
          cell.querySelectorAll("p, div, li").forEach((block) => block.append("\n"));
          return (cell.textContent ?? "").replace(/\u00a0/g, " ").replace(/\n+$/, "").trim();
        }),
      );
      const trimmed = trimTable(rows);
      if (trimmed) return trimmed;
    }
  }
  return tableFromTsv(data.getData("text/plain"));
}
