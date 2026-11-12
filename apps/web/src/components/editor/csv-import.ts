// A CSV (or TSV) file expanded into the page as a table block (no
// dependencies, so it can be tested in Node).

// More than this is cut off (said so): BlockNote's table gets slow to edit.
export const MAX_CSV_ROWS = 1000;
export const MAX_CSV_COLUMNS = 50;

export type CsvTable = {
  // A BlockNote table block: the first row as its header.
  block: {
    type: "table";
    content: { type: "tableContent"; headerRows?: number; rows: { cells: string[] }[] };
  };
  // Rows or columns were left out (over the limits).
  truncated: boolean;
};

// The rows of CSV text (RFC 4180: fields in double quotes may hold the
// delimiter, line breaks and doubled quotes). The delimiter is a tab for a
// .tsv file, or for text whose first line has tabs but no commas; a comma
// otherwise.
export function parseCsv(text: string, fileName = ""): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r\n?|\n/, 1)[0] ?? "";
  const delimiter = /\.tsv$/i.test(fileName) || (firstLine.includes("\t") && !firstLine.includes(",")) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < body.length) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) endField();
    else if (c === "\r" || c === "\n") {
      endRow();
      if (c === "\r" && body[i + 1] === "\n") i++;
    } else field += c;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  // Blank lines (at the end, or between) are no rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// The table block for CSV text, or null when there's nothing in it. Short
// rows are filled with empty cells; line breaks in a cell stay.
export function csvToTable(text: string, fileName = ""): CsvTable | null {
  const rows = parseCsv(text, fileName);
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const columns = Math.min(width, MAX_CSV_COLUMNS);
  const kept = rows.slice(0, MAX_CSV_ROWS);
  return {
    block: {
      type: "table",
      content: {
        type: "tableContent",
        ...(kept.length > 1 ? { headerRows: 1 } : {}),
        rows: kept.map((r) => ({ cells: Array.from({ length: columns }, (_, j) => (r[j] ?? "").trim()) })),
      },
    },
    truncated: rows.length > MAX_CSV_ROWS || width > MAX_CSV_COLUMNS,
  };
}
