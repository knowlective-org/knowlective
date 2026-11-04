import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findFilePaths } from "../src/lib/file-path";

// File paths in a page's text, which a click copies (lib/file-path.ts).
//   pnpm --filter web test:unit

const paths = (text: string) => findFilePaths(text).map((m) => m.path);

describe("file paths in text", () => {
  test("drive, network and file:// paths", () => {
    assert.deepEqual(paths(String.raw`C:\Users\a\report.xlsx`), [String.raw`C:\Users\a\report.xlsx`]);
    assert.deepEqual(paths("D:/data/2026"), ["D:/data/2026"]);
    assert.deepEqual(paths(String.raw`共有は \\fileserver\share\営業\資料`), [String.raw`\\fileserver\share\営業\資料`]);
    assert.deepEqual(paths("file:///C:/Temp/a.txt"), ["file:///C:/Temp/a.txt"]);
  });

  test("ends before sentence punctuation", () => {
    assert.deepEqual(paths(String.raw`保存先は C:\work\out。`), [String.raw`C:\work\out`]);
    assert.deepEqual(paths(String.raw`(see E:\backup).`), [String.raw`E:\backup`]);
  });

  test("a path runs to the end of its line, spaces included", () => {
    assert.deepEqual(paths(String.raw`C:\Program Files\App`), [String.raw`C:\Program Files\App`]);
    assert.deepEqual(paths(String.raw`保存先: \\fileserver\共有 フォルダ\2026 年度\資料.xlsx  `), [
      String.raw`\\fileserver\共有 フォルダ\2026 年度\資料.xlsx`,
    ]);
    // Each line on its own.
    assert.deepEqual(paths(String.raw`C:\a b` + "\n" + String.raw`D:\c d`), [String.raw`C:\a b`, String.raw`D:\c d`]);
  });

  test("in quotes or brackets, a path ends at the closing quote", () => {
    assert.deepEqual(paths(String.raw`「C:\Program Files\App\app.exe」を開く`), [String.raw`C:\Program Files\App\app.exe`]);
    assert.deepEqual(paths(String.raw`"\\srv\share\My Documents" にある`), [String.raw`\\srv\share\My Documents`]);
  });

  test("the offsets point at the path", () => {
    const text = String.raw`見て C:\a\b c `;
    const [m] = findFilePaths(text);
    assert.equal(text.slice(m.start, m.end), String.raw`C:\a\b c`);
  });

  test("not paths", () => {
    for (const text of [
      "https://example.com/a/b",
      "ratio 1:2",
      String.raw`abc:\x`,
      "12:30",
      String.raw`\\server`,
      String.raw`\\server\ `,
      "file://",
      String.raw`C:`,
    ]) {
      assert.deepEqual(paths(text), [], text);
    }
  });
});
