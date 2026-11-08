import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyChatFormat, chatBlocks, chatInline, chatMarkdownPlain } from "../src/lib/chat-markdown";

// Formatting in chat messages (lib/chat-markdown.ts). The text comes from
// whoever posted it: links are http(s) only, and nothing becomes HTML.
//   pnpm --filter web test:unit

const t = (text: string) => ({ type: "text", text });

describe("chat formatting, inline", () => {
  test("bold, italic, strikethrough and code", () => {
    assert.deepEqual(chatInline("a **b** *c* _d_ ~~e~~ `f`"), [
      t("a "),
      { type: "bold", children: [t("b")] },
      t(" "),
      { type: "italic", children: [t("c")] },
      t(" "),
      { type: "italic", children: [t("d")] },
      t(" "),
      { type: "strike", children: [t("e")] },
      t(" "),
      { type: "code", text: "f" },
    ]);
  });

  test("nested, and markers that don't pair stay text", () => {
    assert.deepEqual(chatInline("**bold _and italic_**"), [
      { type: "bold", children: [t("bold "), { type: "italic", children: [t("and italic")] }] },
    ]);
    assert.deepEqual(chatInline("2 * 3 = 6, ** not bold"), [t("2 * 3 = 6, ** not bold")]);
    assert.deepEqual(chatInline("snake_case_name stays"), [t("snake_case_name stays")]);
    assert.deepEqual(chatInline("** spaced **"), [t("** spaced **")]);
  });

  test("code keeps markers and mentions as text", () => {
    assert.deepEqual(chatInline("`**x** <@u1>`"), [{ type: "code", text: "**x** <@u1>" }]);
  });

  test("mentions inside formatting, even with an underscore in the id", () => {
    assert.deepEqual(chatInline("**hi <@a_b>** _x_"), [
      { type: "bold", children: [t("hi "), { type: "mention", userId: "a_b" }] },
      t(" "),
      { type: "italic", children: [t("x")] },
    ]);
  });

  test("links: [text](https://…) and bare URLs, http(s) only", () => {
    assert.deepEqual(chatInline("[the doc](https://example.com/a) and https://example.com/b."), [
      { type: "link", href: "https://example.com/a", children: [t("the doc")] },
      t(" and "),
      { type: "link", href: "https://example.com/b", children: [t("https://example.com/b")] },
      t("."),
    ]);
    for (const text of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](//evil.example)", "[x](file:///etc/passwd)"]) {
      assert.ok(
        chatInline(text).every((n) => n.type === "text"),
        text,
      );
    }
    // No link inside a link's text.
    assert.deepEqual(chatInline("[see https://b.example](https://a.example)"), [
      { type: "link", href: "https://a.example", children: [t("see "), t("https://b.example")] },
    ]);
  });

  test("HTML and private-use characters stay text (no tags, no forged mentions)", () => {
    assert.deepEqual(chatInline("<b>x</b> <img src=x onerror=alert(1)>"), [t("<b>x</b> <img src=x onerror=alert(1)>")]);
    assert.deepEqual(chatInline(" x"), [t(" x")]);
  });
});

describe("chat formatting, by line", () => {
  test("lists, numbered lists, quotes and code blocks; no headings or tables", () => {
    const blocks = chatBlocks("intro\n- a\n- **b**\n3. c\n4. d\n> said\n> - so\n```\n**raw**\n```\n# not a heading\n| a | b |");
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["paragraph", "list", "list", "quote", "code", "paragraph"],
    );
    assert.deepEqual(blocks[1], { type: "list", ordered: false, start: 1, items: [[t("a")], [{ type: "bold", children: [t("b")] }]] });
    assert.deepEqual(blocks[2], { type: "list", ordered: true, start: 3, items: [[t("c")], [t("d")]] });
    assert.deepEqual(blocks[3], {
      type: "quote",
      children: [
        { type: "paragraph", children: [t("said")] },
        { type: "list", ordered: false, start: 1, items: [[t("so")]] },
      ],
    });
    assert.deepEqual(blocks[4], { type: "code", text: "**raw**" });
    assert.deepEqual(blocks[5], { type: "paragraph", children: [t("# not a heading"), { type: "break" }, t("| a | b |")] });
  });

  test("an unclosed code block runs to the end", () => {
    assert.deepEqual(chatBlocks("```\nx\ny"), [{ type: "code", text: "x\ny" }]);
  });

  test("the words alone, for search and excerpts (mentions kept as tokens)", () => {
    assert.equal(chatMarkdownPlain("**Hi** <@u1>, see [the doc](https://e.example)\n- one\n> `two`"), "Hi <@u1>, see the doc\none\ntwo");
  });
});

describe("formatting buttons and shortcuts", () => {
  test("wrapping the selection, or an empty pair at the caret", () => {
    assert.deepEqual(applyChatFormat("say hello now", 4, 9, "bold"), { value: "say **hello** now", start: 6, end: 11 });
    assert.deepEqual(applyChatFormat("ab", 1, 1, "italic"), { value: "a**b", start: 2, end: 2 });
    assert.deepEqual(applyChatFormat("x", 0, 1, "strike"), { value: "~~x~~", start: 2, end: 3 });
    assert.deepEqual(applyChatFormat("a\nb", 0, 3, "code").value, "```\na\nb\n```");
  });

  test("a link selects the address to type over", () => {
    assert.deepEqual(applyChatFormat("the doc", 4, 7, "link"), { value: "the [doc](https://)", start: 10, end: 18 });
  });

  test("lists and quotes prefix every line the selection touches", () => {
    assert.equal(applyChatFormat("a\nb\nc", 0, 3, "bullet").value, "- a\n- b\nc");
    assert.equal(applyChatFormat("a\nb", 2, 2, "numbered").value, "a\n1. b");
    assert.equal(applyChatFormat("a\nb", 0, 3, "quote").value, "> a\n> b");
  });
});
