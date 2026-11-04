// File paths written in a page's text: a drive path (C:\Users\…, D:/data),
// a network path (\\server\share\…) or a file:// URL. A browser won't open
// them from a web page, so the editor copies them on a click instead
// (components/editor/file-paths.ts). Dependency-free, for the unit tests.
//
// Folder and file names often have spaces in them (C:\Program Files\…,
// \\server\共有 フォルダ\…), so a path runs to the end of its block (line),
// spaces included. One in quotes or 「」『』 ends at the closing quote, so
// text can follow it.

export type PathMatch = { start: number; end: number; path: string };

const START = String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\\s"“”「」『』]+\\|file:\/\/)`;
const QUOTED = new RegExp(String.raw`["“「『](${START}[^"“”「」『』\r\n]*?)["”」』]`, "g");
// To the end of the line; <>|" can't be in a Windows path.
const BARE = new RegExp(String.raw`${START}[^\r\n"<>|]*`, "g");
// Spaces and punctuation that end the sentence rather than the path.
const TRAILING = /[\s。、，,.;；:：!！?？)）\]】]+$/;

export function findFilePaths(text: string): PathMatch[] {
  const found: PathMatch[] = [];
  for (const m of text.matchAll(QUOTED)) {
    const start = m.index + m[0].indexOf(m[1]);
    found.push({ start, end: start + m[1].length, path: m[1] });
  }
  for (const m of text.matchAll(BARE)) {
    const path = m[0].replace(TRAILING, "");
    const start = m.index;
    const end = start + path.length;
    if (!isPath(path) || found.some((f) => start < f.end && end > f.start)) continue;
    found.push({ start, end, path });
  }
  return found.sort((a, b) => a.start - b.start);
}

// More than the start alone ("C:\" is a path; "\\server\" or "file://" isn't).
function isPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]/.test(path) || /^file:\/\/./.test(path);
}
