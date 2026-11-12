import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodeHighlighter } from "../src/components/editor/code-highlighter";

// Code blocks' highlighting (components/editor/code-highlighter.ts).

const scopes = async (lang: string, code: string) => {
  const h = await createCodeHighlighter();
  await h.loadLanguage(lang as never);
  const { tokens } = h.codeToTokens(code, { lang, theme: "github-dark", includeExplanation: true });
  return tokens.flat().map((t) => ({ text: t.content, scopes: (t.explanation ?? []).flatMap((e) => e.scopes.map((s) => s.scopeName)) }));
};

test("HTML: CSS in <style> and JavaScript in <script>, and the markup after them", async () => {
  const tokens = await scopes("html", "<style>\n  body { color: red; }\n</style>\n<script>\nconst a = 1;\n</script>\n<p class=\"x\">hi</p>");
  const scopesOf = (text: string) => tokens.find((t) => t.text.trim() === text)?.scopes ?? [];
  assert.ok(scopesOf("color").includes("support.type.property-name.css"));
  assert.ok(scopesOf("const").some((s) => s.endsWith(".js")));
  assert.ok(scopesOf("p").includes("entity.name.tag.html"));
  assert.ok(!tokens.some((t) => t.scopes.some((s) => s.startsWith("invalid."))), "nothing marked invalid");
});
