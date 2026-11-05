import { expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// Chat blocks: replies, mentions, links, copying the text, and locking.
test.use({ storageState: authFile("editor") });

async function insertChat(page: import("@playwright/test").Page) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/チャット");
  await page.getByRole("option", { name: /チャット/ }).first().click();
  await expect(page.getByTestId("ChatBlock.empty")).toBeVisible();
}

test("replies quote the message, mentions are by name, and URLs are links", async ({ page }) => {
  const { id } = await createPage(page, "E2E チャットの返信");
  await insertChat(page);
  const input = page.getByTestId("ChatBlock.messageInput");
  await input.fill("資料は https://example.com/doc. です");
  await page.keyboard.press("Enter");
  const first = page.getByTestId("ChatBlock.messageRow").first();
  const link = first.getByTestId("ChatBlock.textLink");
  await expect(link).toHaveAttribute("href", "https://example.com/doc");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");

  // A reply, with a mention picked from the "@" menu.
  await first.getByTestId("ChatBlock.replyButton").click();
  await expect(page.getByTestId("ChatBlock.replyingStatus")).toContainText("資料は");
  await input.click();
  await page.keyboard.type("確認お願いします @E2E 管");
  await expect(page.getByTestId("ChatBlock.mentionItem")).toHaveText([ACCOUNTS.admin.name]);
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue(`確認お願いします @${ACCOUNTS.admin.name} `);
  await page.keyboard.press("Enter");

  const reply = page.getByTestId("ChatBlock.messageRow").nth(1);
  await expect(reply.getByTestId("ChatBlock.replyQuote")).toContainText("資料は https://example.com/doc. です");
  await expect(reply.getByTestId("ChatBlock.mention")).toHaveText(`@${ACCOUNTS.admin.name}`);
  await expect(page.getByTestId("ChatBlock.replyingStatus")).toHaveCount(0);
  // Stored with the person's id, not their name, and replying to the first.
  const rows = await withPrisma((prisma) =>
    prisma.chatMessage.findMany({ where: { pageId: id }, orderBy: { createdAt: "asc" }, select: { id: true, replyToId: true } }),
  );
  expect(rows[1].replyToId).toBe(rows[0].id);

  // The mentioned person is notified of the mention.
  await expect
    .poll(() =>
      withPrisma(async (prisma) => {
        const admin = await prisma.user.findFirst({ where: { name: ACCOUNTS.admin.name }, select: { id: true } });
        return prisma.notification.count({ where: { pageId: id, userId: admin!.id, kind: "MENTION" } });
      }),
    )
    .toBe(1);

  // The messages' text can be selected (and so copied).
  const text = first.getByTestId("ChatBlock.text");
  await text.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});

// Locking, called directly (not from the screen): only someone who can edit
// the page can. Its id is in the editor's scripts.
test("locking a chat, called directly, only works for someone who can edit the page", async ({ page, browser, baseURL }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  const { id } = await createPage(page, "E2E チャットのロックの権限");
  await insertChat(page);
  const blockId = (await page.locator('.bn-block-outer:has([data-ui="ChatBlock"])').getAttribute("data-id"))!;
  const source = (await Promise.all(scripts)).join("\n");
  const actionId = source.match(/"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"setChatLocked"/)?.[1];
  expect(actionId, "setChatLocked's action id").toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const locked = () => withPrisma((prisma) => prisma.chatLock.count({ where: { pageId: id } }));

  for (const role of ["guest", "outsider", "viewer", "editor"] as const) {
    const context = await browser.newContext({ storageState: role === "guest" ? { cookies: [], origins: [] } : authFile(role) });
    await context.request.post(`pages/${id}`, {
      headers: { "Next-Action": actionId!, Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
      data: JSON.stringify([id, blockId, true]),
      maxRedirects: 0,
    });
    await context.close();
    expect(await locked(), role).toBe(role === "editor" ? 1 : 0);
  }
  await trashOpenPage(page);
});

test("a locked chat takes no new messages or changes, for anyone, until unlocked", async ({ page, browser }) => {
  const { id } = await createPage(page, "E2E チャットのロック");
  await insertChat(page);
  await page.getByTestId("ChatBlock.messageInput").fill("ロック前");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ChatBlock.messageRow")).toHaveCount(1);

  await page.getByTestId("ChatBlock.lockButton").click();
  await expect(page.getByTestId("ChatBlock.lockedStatus")).toBeVisible();
  await expect(page.getByTestId("ChatBlock.form")).toHaveCount(0);
  await expect(page.getByTestId("ChatBlock.editButton")).toHaveCount(0);
  await expect(page.getByTestId("ChatBlock.replyButton")).toHaveCount(0);

  // Someone else who can edit the page sees it locked too.
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1500);
  const adminContext = await browser.newContext({ storageState: authFile("admin") });
  try {
    const admin = await adminContext.newPage();
    await openPage(admin, id);
    await expect(admin.getByTestId("ChatBlock.lockedStatus")).toBeVisible();
    await expect(admin.getByTestId("ChatBlock.form")).toHaveCount(0);
    // And can unlock it.
    await admin.getByTestId("ChatBlock.unlockButton").click();
    await admin.getByTestId("AppDialog.confirmButton").click();
    await expect(admin.getByTestId("ChatBlock.form")).toBeVisible();
  } finally {
    await adminContext.close();
  }
  await expect(page.getByTestId("ChatBlock.form")).toBeVisible();
  await expect(page.getByTestId("ChatBlock.lockedStatus")).toHaveCount(0);
  await trashOpenPage(page);
});
