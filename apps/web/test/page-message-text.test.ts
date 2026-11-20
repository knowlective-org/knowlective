import { test } from "node:test";
import assert from "node:assert/strict";
import { messageParts } from "../src/lib/page-message-text";

test("bare http(s) URLs become links, the rest stays text", () => {
  assert.deepEqual(messageParts("Build done: https://ci.example.com/run/1 (all green)"), [
    { text: "Build done: " },
    { text: "https://ci.example.com/run/1", href: "https://ci.example.com/run/1" },
    { text: " (all green)" },
  ]);
});

test("sentence punctuation after a URL isn't part of it", () => {
  assert.deepEqual(messageParts("See http://x.example/a."), [{ text: "See " }, { text: "http://x.example/a", href: "http://x.example/a" }, { text: "." }]);
  assert.deepEqual(messageParts("詳細はhttps://x.example/aを。"), [
    { text: "詳細は" },
    { text: "https://x.example/aを", href: "https://x.example/aを" },
    { text: "。" },
  ]);
});

test("a balanced closing parenthesis stays in the URL", () => {
  assert.deepEqual(messageParts("(https://w.example/A_(b))"), [
    { text: "(" },
    { text: "https://w.example/A_(b)", href: "https://w.example/A_(b)" },
    { text: ")" },
  ]);
});

test("other schemes never become links", () => {
  for (const text of ["javascript:alert(1)", "data:text/html,<script>x</script>", "JAVASCRIPT://x.example/%0aalert(1)", "file:///etc/passwd", "https://"]) {
    assert.ok(messageParts(text).every((p) => !p.href), text);
  }
});

test("text with no URL is one part; empty text none", () => {
  assert.deepEqual(messageParts("line 1\nline 2"), [{ text: "line 1\nline 2" }]);
  assert.deepEqual(messageParts(""), []);
});
