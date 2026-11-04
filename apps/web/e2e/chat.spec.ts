import { type Browser, expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

test("a chat block: own messages on the right, others' on the left with their name; viewers only read", async ({ page, browser }) => {
  const { id } = await createPage(page, "E2E チャット");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/チャット");
  await page.getByRole("option", { name: /チャット/ }).first().click();
  await expect(page.getByTestId("ChatBlock.empty")).toBeVisible();

  // Enter sends; Shift+Enter is a new line.
  await page.getByTestId("ChatBlock.messageInput").click();
  await page.keyboard.type("こんにちは");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("二行目");
  await page.keyboard.press("Enter");
  const mine = page.getByTestId("ChatBlock.messageRow").first();
  await expect(mine).toHaveAttribute("data-mine", "true");
  await expect(mine.getByTestId("ChatBlock.text")).toHaveText("こんにちは\n二行目");
  await expect(mine.getByTestId("ChatBlock.author")).toHaveCount(0);
  await expect(page.getByTestId("ChatBlock.messageInput")).toHaveValue("");

  // Stored encrypted (the text isn't in the row).
  const stored = await withPrisma((prisma) => prisma.chatMessage.findFirstOrThrow({ where: { pageId: id } }));
  expect(Buffer.from(stored.bodyEnc).toString("utf8")).not.toContain("こんにちは");

  // Let the block reach the server before someone else opens the page.
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1500);

  const adminContext = await browser.newContext({ storageState: authFile("admin") });
  const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
  try {
    const admin = await adminContext.newPage();
    await openPage(admin, id);
    const theirs = admin.getByTestId("ChatBlock.messageRow").first();
    await expect(theirs).not.toHaveAttribute("data-mine");
    await expect(theirs.getByTestId("ChatBlock.author")).toHaveText(ACCOUNTS.editor.name);

    // A reply reaches the first editor without a reload, on the left.
    await admin.getByTestId("ChatBlock.messageInput").fill("返信です");
    await admin.getByTestId("ChatBlock.sendButton").click();
    const reply = page.getByTestId("ChatBlock.messageRow").filter({ hasText: "返信です" });
    await expect(reply).toBeVisible();
    await expect(reply).not.toHaveAttribute("data-mine");
    await expect(reply.getByTestId("ChatBlock.author")).toHaveText(ACCOUNTS.admin.name);
    // The newest is at the bottom of the log.
    await expect(page.getByTestId("ChatBlock.messageRow").last()).toContainText("返信です");

    // Only one's own messages can be changed; a change shows as edited, for everyone.
    await expect(reply.getByTestId("ChatBlock.editButton")).toHaveCount(0);
    await expect(theirs.getByTestId("ChatBlock.editButton")).toHaveCount(0);
    await mine.getByTestId("ChatBlock.editButton").click();
    await mine.getByTestId("ChatBlock.editInput").fill("こんにちは（直しました）");
    await page.keyboard.press("Enter");
    await expect(mine.getByTestId("ChatBlock.text")).toHaveText("こんにちは（直しました）");
    await expect(mine.getByTestId("ChatBlock.editedStatus")).toContainText("編集済み");
    await expect(theirs.getByTestId("ChatBlock.text")).toHaveText("こんにちは（直しました）");
    await expect(theirs.getByTestId("ChatBlock.editedStatus")).toBeVisible();
    // Esc leaves it as it was.
    await mine.getByTestId("ChatBlock.editButton").click();
    await mine.getByTestId("ChatBlock.editInput").fill("取り消す");
    await page.keyboard.press("Escape");
    await expect(mine.getByTestId("ChatBlock.text")).toHaveText("こんにちは（直しました）");

    // Taking it back leaves "unsent" in its place, for everyone; the text is gone.
    await expect(theirs.getByTestId("ChatBlock.deleteButton")).toHaveCount(0);
    await mine.getByTestId("ChatBlock.deleteButton").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(mine.getByTestId("ChatBlock.unsentStatus")).toHaveText("送信取消");
    await expect(mine.getByTestId("ChatBlock.editButton")).toHaveCount(0);
    await expect(theirs.getByTestId("ChatBlock.unsentStatus")).toHaveText("送信取消");
    await expect(theirs.getByTestId("ChatBlock.text")).toHaveCount(0);
    await expect(theirs.getByTestId("ChatBlock.author")).toHaveText(ACCOUNTS.editor.name);

    const viewer = await viewerContext.newPage();
    await openPage(viewer, id);
    await expect(viewer.getByTestId("ChatBlock.messageRow")).toHaveCount(2);
    await expect(viewer.getByTestId("ChatBlock.form")).toHaveCount(0);
    await expect(viewer.getByTestId("ChatBlock.editButton")).toHaveCount(0);
  } finally {
    await adminContext.close();
    await viewerContext.close();
  }
  await trashOpenPage(page);
});

// The chat's Server Action, called directly (not from the screen) by people
// who mustn't post: nothing is stored. Its id is in the editor's scripts.
test("posting to a chat, called directly, only works for someone who can edit the page", async ({ page, browser, baseURL }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  const { id } = await createPage(page, "E2E チャットの権限");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/チャット");
  await page.getByRole("option", { name: /チャット/ }).first().click();
  await expect(page.getByTestId("ChatBlock.empty")).toBeVisible();
  const blockId = (await page.locator('.bn-block-outer:has([data-ui="ChatBlock"])').getAttribute("data-id"))!;

  const source = (await Promise.all(scripts)).join("\n");
  const actionId = source.match(/"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"postChatMessage"/)?.[1];
  expect(actionId, "postChatMessage's action id").toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const count = () => withPrisma((prisma) => prisma.chatMessage.count({ where: { pageId: id } }));
  const contextFor = (b: Browser, role: "guest" | "outsider" | "viewer" | "editor") =>
    b.newContext({ storageState: role === "guest" ? { cookies: [], origins: [] } : authFile(role) });

  for (const role of ["guest", "outsider", "viewer", "editor"] as const) {
    const context = await contextFor(browser, role);
    await context.request.post(`pages/${id}`, {
      headers: { "Next-Action": actionId!, Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
      data: JSON.stringify([id, blockId, `${role} から`]),
      maxRedirects: 0,
    });
    await context.close();
    // Refused for all but the editor (so the refusals mean something).
    expect(await count(), role).toBe(role === "editor" ? 1 : 0);
  }
  await trashOpenPage(page);
});

// Changing a message, called directly: only its author (who can still edit
// the page) can, not someone else who can edit the page, nor anyone else.
test("changing a message, called directly, only works for its author", async ({ page, browser, baseURL }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  const { id } = await createPage(page, "E2E チャットの編集の権限");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/チャット");
  await page.getByRole("option", { name: /チャット/ }).first().click();
  await page.getByTestId("ChatBlock.messageInput").fill("元の文");
  await page.getByTestId("ChatBlock.sendButton").click();
  const row = page.getByTestId("ChatBlock.messageRow");
  await expect(row).toHaveCount(1);
  const messageId = (await row.getAttribute("data-id"))!;

  const source = (await Promise.all(scripts)).join("\n");
  const actionId = source.match(/"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"editChatMessage"/)?.[1];
  expect(actionId, "editChatMessage's action id").toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const edited = () =>
    withPrisma((prisma) => prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, select: { editedAt: true } }));

  for (const role of ["guest", "outsider", "viewer", "admin", "editor"] as const) {
    const context = await browser.newContext({ storageState: role === "guest" ? { cookies: [], origins: [] } : authFile(role) });
    await context.request.post(`pages/${id}`, {
      headers: { "Next-Action": actionId!, Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
      data: JSON.stringify([messageId, `${role} が書き換え`]),
      maxRedirects: 0,
    });
    await context.close();
    // Refused for all but the author (so the refusals mean something).
    expect((await edited()).editedAt !== null, role).toBe(role === "editor");
  }
  await expect(row.getByTestId("ChatBlock.text")).toHaveText("editor が書き換え");

  // Taking it back, the same way.
  const deleteId = source.match(/"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"deleteChatMessage"/)?.[1];
  expect(deleteId, "deleteChatMessage's action id").toBeTruthy();
  const deleted = () =>
    withPrisma((prisma) => prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, select: { deletedAt: true } }));
  for (const role of ["guest", "outsider", "viewer", "admin", "editor"] as const) {
    const context = await browser.newContext({ storageState: role === "guest" ? { cookies: [], origins: [] } : authFile(role) });
    await context.request.post(`pages/${id}`, {
      headers: { "Next-Action": deleteId!, Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
      data: JSON.stringify([messageId]),
      maxRedirects: 0,
    });
    await context.close();
    expect((await deleted()).deletedAt !== null, role).toBe(role === "editor");
  }
  await expect(row.getByTestId("ChatBlock.unsentStatus")).toBeVisible();
  // Gone, not hidden: the stored text is an empty one now.
  const stored = await withPrisma((prisma) => prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId } }));
  expect(stored.bodyEnc.length).toBeLessThan(64);
  await trashOpenPage(page);
});
