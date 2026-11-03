import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findFilePaths } from "../src/lib/file-path";

// File paths in a page's text, which a click copies (lib/file-path.ts).
//   pnpm --filter web test:unit

const paths = (text: string) => findFilePaths(text).map((m) => m.path);

describe("file paths in text", () => {
  test("drive, network and file:// paths", () => {
    assert.deepEqual(paths(String.raw`C:\Users\a\report.xlsx を見てください`), [String.raw`C:\Users\a\report.xlsx`]);
    assert.deepEqual(paths("D:/data/2026"), ["D:/data/2026"]);
    assert.deepEqual(paths(String.raw`共有は \\fileserver\share\営業\資料 です`), [String.raw`\\fileserver\share\営業\資料`]);
    assert.deepEqual(paths("file:///C:/Temp/a.txt"), ["file:///C:/Temp/a.txt"]);
  });

  test("ends before sentence punctuation", () => {
    assert.deepEqual(paths(String.raw`保存先は C:\work\out。`), [String.raw`C:\work\out`]);
    assert.deepEqual(paths(String.raw`(see E:\backup).`), [String.raw`E:\backup`]);
  });

  test("a path with spaces counts whole only in quotes or brackets", () => {
    assert.deepEqual(paths(String.raw`「C:\Program Files\App\app.exe」`), [String.raw`C:\Program Files\App\app.exe`]);
    assert.deepEqual(paths(String.raw`"\\srv\share\My Documents"`), [String.raw`\\srv\share\My Documents`]);
    assert.deepEqual(paths(String.raw`C:\Program Files\App`), [String.raw`C:\Program`]);
  });

  test("the offsets point at the path", () => {
    const text = String.raw`見て C:\a\b ね`;
    const [m] = findFilePaths(text);
    assert.equal(text.slice(m.start, m.end), String.raw`C:\a\b`);
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
