import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPageIds } from "../src/lib/audit-pages";

// Which pages an audit log entry names (lib/audit-pages.ts): the admin
// console hides it from those who can't open one of them.

test("entries naming pages: their ids from the detail", () => {
  assert.deepEqual(auditPageIds("page.move", { pageId: "a", fromParentId: "b", toParentId: "c", toRootId: "r" }), ["a", "b", "c"]);
  assert.deepEqual(auditPageIds("page.restore.move", { pageId: "a", fromParentId: "a", toParentId: null }), ["a"]);
  assert.deepEqual(auditPageIds("page.grant.set", { pageId: "p", groupId: "g" }), ["p"]);
  assert.deepEqual(auditPageIds("landing-page.settings", { pageId: null }), []);
});

test("entries naming no page, or only knowledge roots: none", () => {
  assert.equal(auditPageIds("user.role", { pageId: "x" }), null);
  assert.equal(auditPageIds("root.create", { rootPageId: "r" }), null);
  assert.equal(auditPageIds("root.delete", { rootPageId: "r" }), null);
});

test("a malformed detail names nothing", () => {
  assert.deepEqual(auditPageIds("page.lock", null), []);
  assert.deepEqual(auditPageIds("page.lock", { pageId: 5 }), []);
});
