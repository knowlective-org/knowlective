import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EVERYONE, chatMentionIds, chatMentionsEveryone, chatPlainText, chatSegments, chatTextFromDisplay, mentionQueries } from "../src/lib/chat-text";

// A chat message's links and mentions (lib/chat-text.ts). The text comes
// from whoever posted it, so only http(s) URLs become links.
//   pnpm --filter web test:unit

describe("chat message text", () => {
  test("http(s) URLs become links, without the punctuation after them", () => {
    assert.deepEqual(chatSegments("see https://example.com/a?b=1."), [
      { type: "text", text: "see " },
      { type: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { type: "text", text: "." },
    ]);
    assert.deepEqual(
      chatSegments("資料は「https://example.com/x」です").map((s) => s.type),
      ["text", "link", "text"],
    );
  });
  test("other schemes stay text", () => {
    for (const text of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "http://"]) {
      assert.ok(chatSegments(text).every((s) => s.type === "text"), text);
    }
  });
  test("mentions", () => {
    assert.deepEqual(chatSegments("hi <@u1>, <@u2>"), [
      { type: "text", text: "hi " },
      { type: "mention", userId: "u1" },
      { type: "text", text: ", " },
      { type: "mention", userId: "u2" },
    ]);
    assert.deepEqual(chatMentionIds("<@a> <@b> <@a> <@bad id>"), ["a", "b"]);
    assert.equal(chatPlainText("<@a> and <@x>", (id) => (id === "a" ? "Ann" : null), "someone"), "@Ann and @someone");
  });
  test("everyone: its own token, not a person", () => {
    const text = `<@${EVERYONE}> please read, <@u1>`;
    assert.ok(chatMentionsEveryone(text));
    assert.ok(!chatMentionsEveryone("<@u1> all"));
    // Not among the people mentioned (no lookups, no notification by id).
    assert.deepEqual(chatMentionIds(text), ["u1"]);
    assert.deepEqual(chatSegments(text)[0], { type: "mention", userId: EVERYONE });
    assert.equal(chatPlainText(text, () => "Ann", "someone", "everyone"), "@everyone please read, @Ann");
  });
});

describe("mentions typed in the message box", () => {
  const ann = { id: "ann", name: "Ann" };
  const sales = { id: "sales", name: "山田@営業部" };
  const dept = { id: "dept", name: "営業部" };

  test("a name with an \"@\" in it becomes one mention", () => {
    assert.equal(chatTextFromDisplay("@山田@営業部 さん", [dept, sales]), "<@sales> さん");
    assert.equal(chatTextFromDisplay("これは@Ann です", [ann]), "これは<@ann> です");
  });

  test("an email address isn't taken for a mention", () => {
    assert.equal(chatTextFromDisplay("mail ann@Ann.example", [ann]), "mail ann@Ann.example");
    assert.equal(chatTextFromDisplay("x@営業部", [dept]), "x@営業部");
  });

  test("the menu searches from the farthest \"@\", including names with \"@\"", () => {
    assert.deepEqual(
      mentionQueries("@山田@営", 5).map((c) => c.query),
      ["山田@営", "営"],
    );
    assert.deepEqual(
      mentionQueries("hi @Ann@Sa", 10).map((c) => c.query),
      ["Ann@Sa"],
    );
    assert.deepEqual(mentionQueries("ann@ex", 6), []);
    assert.deepEqual(mentionQueries("@a\n@b", 5).map((c) => c.query), ["b"]);
  });
});
