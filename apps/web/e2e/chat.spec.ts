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
  const mine = page.getByTestId("ChatBlock.messageRow").filter({ hasText: "こんにちは" });
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
    const theirs = admin.getByTestId("ChatBlock.messageRow").filter({ hasText: "こんにちは" });
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

    const viewer = await viewerContext.newPage();
    await openPage(viewer, id);
    await expect(viewer.getByTestId("ChatBlock.messageRow")).toHaveCount(2);
    await expect(viewer.getByTestId("ChatBlock.form")).toHaveCount(0);
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
