import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileIdOf, fileUrl } from "../src/lib/file-url";

// Attachment URLs in a page's body, which come from the shared document (and
// the API's Markdown): only the exact form is an attachment of this site.
describe("fileIdOf", () => {
  test("the form pages keep", () => {
    assert.equal(fileIdOf("/api/files/cmwbjby2h000f01mu4d9tyti0"), "cmwbjby2h000f01mu4d9tyti0");
    assert.equal(fileIdOf(fileUrl("abc_-9")), "abc_-9");
  });

  test("the absolute form of the Markdown export, with the site's URL only", () => {
    const site = "https://example.com/knowlective";
    assert.equal(fileIdOf("https://example.com/knowlective/api/files/abc", site), "abc");
    assert.equal(fileIdOf("https://example.com/knowlective/api/files/abc"), null);
    assert.equal(fileIdOf("https://example.com/api/files/abc", site), null);
    assert.equal(fileIdOf("https://evil.example/knowlective/api/files/abc", site), null);
    assert.equal(fileIdOf("https://example.com/knowlective.evil/api/files/abc", site), null);
  });

  test("anything else", () => {
    for (const url of [
      undefined,
      null,
      42,
      "",
      "/api/files/",
      "/api/files/abc/extra",
      "/api/files/abc?x=1",
      "/api/files/../admin",
      "/api/files/a%2Fb",
      "/knowlective/api/files/abc",
      "api/files/abc",
      "//evil.example/api/files/abc",
      `/api/files/${"a".repeat(65)}`,
    ]) {
      assert.equal(fileIdOf(url), null, String(url));
    }
  });
});
