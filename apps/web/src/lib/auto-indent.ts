// A new line in code keeps the indentation of the line it's made from (the
// code block in the editor, and code in a chat message). No dependencies
// (unit tests: test/reindent.test.ts).

// The spaces and tabs the line ending at `caret` in `text` starts with.
export function lineIndent(text: string, caret: number): string {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start, caret))![0];
}

// Whether `caret` is inside a ``` fence (Markdown code) of `text`: an odd
// number of fence lines before it.
export function insideCodeFence(text: string, caret: number): boolean {
  let open = false;
  for (const line of text.slice(0, caret).split("\n").slice(0, -1)) {
    if (/^\s*```/.test(line)) open = !open;
  }
  return open;
}
