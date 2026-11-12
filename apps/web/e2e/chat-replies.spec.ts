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

test("part of a message can be quoted, and code keeps its indentation on a new line", async ({ page }) => {
  await createPage(page, "E2E チャットの部分引用");
  await insertChat(page);
  const input = page.getByTestId("ChatBlock.messageInput");
  await input.fill("明日の会議は10時からです");
  await page.keyboard.press("Enter");
  const text = page.getByTestId("ChatBlock.messageRow").first().getByTestId("ChatBlock.text");
  await expect(text).toHaveText("明日の会議は10時からです");
  // Sent: the box takes the focus back, which would undo a selection made
  // before.
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();

  // Select "10時から" in the message.
  await text.evaluate((el) => {
    const node = el.querySelector("*:not(:has(*))")?.firstChild ?? el.firstChild!;
    const start = node.textContent!.indexOf("10時から");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "10時から".length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.getByTestId("ChatBlock.quoteSelectionButton").click();
  await expect(page.getByTestId("ChatBlock.replyingStatus")).toContainText("10時から");
  await expect(input).toHaveValue("> 10時から\n");
  await page.keyboard.type("了解です");
  await page.keyboard.press("Enter");
  const reply = page.getByTestId("ChatBlock.messageRow").nth(1);
  await expect(reply.getByTestId("ChatBlock.replyQuote")).toContainText("明日の会議");
  await expect(reply.getByTestId("ChatBlock.text")).toContainText("10時から");
  await expect(reply.getByTestId("ChatBlock.text")).toContainText("了解です");

  // In code (``` fences), Shift+Enter keeps the line's indentation.
  await input.click();
  await page.keyboard.type("```");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("    a();");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("b();");
  await expect(input).toHaveValue("```\n    a();\n    b();");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});

test("@everyone: offered first, shown in the viewer's language, notifying everyone who can open the page, once in 5 minutes", async ({ page }) => {
  const { id } = await createPage(page, "E2E チャットの全員");
  await insertChat(page);
  const input = page.getByTestId("ChatBlock.messageInput");
  await input.click();
  await page.keyboard.type("@全");
  await expect(page.getByTestId("ChatBlock.mentionItem").first()).toHaveAttribute("data-id", "all");
  await expect(page.getByTestId("ChatBlock.mentionItem").first()).toContainText("全員");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("@全員 ");
  await page.keyboard.type("資料を見ておいてください");
  await page.keyboard.press("Enter");
  const mention = page.getByTestId("ChatBlock.messageRow").first().getByTestId("ChatBlock.mention");
  await expect(mention).toHaveText("@全員");
  await expect(mention).toHaveAttribute("data-id", "all");
  // Kept as the token for everyone, not a name.
  const { recipients, outsider } = await withPrisma(async (prisma) => {
    const ids = async (...names: string[]) =>
      (await prisma.user.findMany({ where: { name: { in: names } }, select: { id: true } })).map((u) => u.id);
    return { recipients: await ids(ACCOUNTS.admin.name, ACCOUNTS.viewer.name), outsider: await ids(ACCOUNTS.outsider.name) };
  });
  // Everyone else who can open the page is notified of the mention; someone
  // who can't, isn't.
  await expect
    .poll(() => withPrisma((prisma) => prisma.notification.count({ where: { pageId: id, userId: { in: recipients }, kind: "MENTION" } })))
    .toBe(2);
  expect(await withPrisma((prisma) => prisma.notification.count({ where: { pageId: id, userId: { in: outsider } } }))).toBe(0);

  // Again right away: refused, and the message stays in the box. (Once the
  // first is sent: until then the box is disabled, and keys don't reach it.)
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
  await page.keyboard.type("@全員");
  await page.keyboard.press("Enter");
  await page.keyboard.type("もう一度");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("AppDialog.message")).toContainText("5分に1回");
  await page.getByTestId("AppDialog.closeButton").click();
  await expect(page.getByTestId("ChatBlock.messageRow")).toHaveCount(1);
  await expect(input).toHaveValue("@全員 もう一度");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});

test("messages are formatted with Markdown, typed or from the buttons and shortcuts; HTML stays text", async ({ page }) => {
  await createPage(page, "E2E チャットの書式");
  await insertChat(page);
  const input = page.getByTestId("ChatBlock.messageInput");
  await input.click();
  // Typed: bold, code, a list (Shift+Enter for new lines), and HTML.
  await page.keyboard.type("**太字** と `code` <b>タグ</b>");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("- ひとつめ");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("- ふたつめ");
  await page.keyboard.press("Enter");
  const first = page.getByTestId("ChatBlock.messageRow").first().getByTestId("ChatBlock.text");
  await expect(first.locator("strong")).toHaveText("太字");
  await expect(first.locator("code")).toHaveText("code");
  await expect(first.locator('[role="listitem"]')).toHaveText(["•ひとつめ", "•ふたつめ"]);
  await expect(first.locator("b")).toHaveCount(0);
  await expect(first).toContainText("<b>タグ</b>");

  // From the keyboard and the buttons: the selection is formatted.
  await input.click();
  await page.keyboard.type("大事");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+b");
  await expect(input).toHaveValue("**大事**");
  // The selection is put back in the next frame, after the value: wait for it
  // before typing on (or the keys land on the old selection).
  const selection = () => input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);
  await expect.poll(selection).toEqual([2, 4]);
  await page.keyboard.press("End");
  await page.keyboard.type(" 資料");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.locator('[data-ui="ChatBlock.formatButton"][data-id="link"]').click();
  await expect(input).toHaveValue("**大事** [資料](https://)");
  await expect.poll(selection).toEqual([12, 20]);
  // The address is selected: typed over.
  await page.keyboard.type("https://example.com/doc");
  await page.keyboard.press("Enter");
  const second = page.getByTestId("ChatBlock.messageRow").nth(1).getByTestId("ChatBlock.text");
  await expect(second.locator("strong")).toHaveText("大事");
  await expect(second.getByTestId("ChatBlock.textLink")).toHaveAttribute("href", "https://example.com/doc");
  await expect(second.getByTestId("ChatBlock.textLink")).toHaveText("資料");
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

test("reactions: others' messages only, for those who can edit the page; names on hover", async ({ page, browser, baseURL }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  const { id } = await createPage(page, "E2E チャットのリアクション");
  await insertChat(page);
  await page.getByTestId("ChatBlock.messageInput").fill("リアクションしてください");
  await page.keyboard.press("Enter");
  const mine = page.getByTestId("ChatBlock.messageRow").first();
  await expect(mine.getByTestId("ChatBlock.text")).toBeVisible();
  // Not on one's own message.
  await expect(mine.getByTestId("ChatBlock.addReactionButton")).toHaveCount(0);
  const messageId = (await mine.getAttribute("data-id"))!;

  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1500);
  const adminContext = await browser.newContext({ storageState: authFile("admin") });
  try {
    const admin = await adminContext.newPage();
    await openPage(admin, id);
    const theirs = admin.getByTestId("ChatBlock.messageRow").first();
    await theirs.hover();
    await theirs.getByTestId("ChatBlock.addReactionButton").click();
    await admin.getByTestId("ChatBlock.reactionItem").and(admin.locator('[data-id="👍"]')).click();
    const chip = theirs.getByTestId("ChatBlock.reactionButton");
    await expect(chip).toHaveText("👍 1");
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(admin.getByTestId("ChatBlock.reactionMenu")).toHaveCount(0);

    // The author sees it (not as a button), with who reacted.
    const status = mine.getByTestId("ChatBlock.reactionStatus");
    await expect(status).toHaveText("👍 1");
    await expect(status).toHaveAttribute("title", `👍 ${ACCOUNTS.admin.name}`);
    await expect(mine.getByTestId("ChatBlock.reactionButton")).toHaveCount(0);

    // A click on one's own reaction takes it away.
    await chip.click();
    await expect(theirs.getByTestId("ChatBlock.reactionButton")).toHaveCount(0);
    await expect(mine.getByTestId("ChatBlock.reactionStatus")).toHaveCount(0);
    await theirs.hover();
    await theirs.getByTestId("ChatBlock.addReactionButton").click();
    await admin.getByTestId("ChatBlock.reactionItem").and(admin.locator('[data-id="🎉"]')).click();
    await expect(mine.getByTestId("ChatBlock.reactionStatus")).toHaveText("🎉 1");
  } finally {
    await adminContext.close();
  }

  // Called directly: only someone else who can edit the page (not the
  // author, a viewer, an outsider or someone not logged in), and only the
  // offered emoji.
  const source = (await Promise.all(scripts)).join("\n");
  const actionId = source.match(/"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"setChatReaction"/)?.[1];
  expect(actionId, "setChatReaction's action id").toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const reactions = () => withPrisma((prisma) => prisma.chatReaction.count({ where: { messageId, emoji: "👀" } }));
  for (const role of ["guest", "outsider", "viewer", "editor", "admin"] as const) {
    const context = await browser.newContext({ storageState: role === "guest" ? { cookies: [], origins: [] } : authFile(role) });
    for (const emoji of ["💩", "👀"]) {
      await context.request.post(`pages/${id}`, {
        headers: { "Next-Action": actionId!, Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
        data: JSON.stringify([messageId, emoji, true]),
        maxRedirects: 0,
      });
    }
    await context.close();
    expect(await reactions(), role).toBe(role === "admin" ? 1 : 0);
  }
  expect(await withPrisma((prisma) => prisma.chatReaction.count({ where: { messageId, emoji: "💩" } }))).toBe(0);

  // Taking the message back takes its reactions with it.
  await mine.getByTestId("ChatBlock.deleteButton").click();
  await page.getByTestId("AppDialog.confirmButton").click();
  await expect(mine.getByTestId("ChatBlock.unsentStatus")).toBeVisible();
  await expect(mine.getByTestId("ChatBlock.reactions")).toHaveCount(0);
  expect(await withPrisma((prisma) => prisma.chatReaction.count({ where: { messageId } }))).toBe(0);
  await trashOpenPage(page);
});

test("a chat has a title, and each viewer can fold it to the title alone", async ({ page, browser }) => {
  const { id } = await createPage(page, "E2E チャットのタイトル");
  await insertChat(page);
  const title = page.getByTestId("ChatBlock.titleInput");
  await expect(title).toHaveAttribute("placeholder", "チャット");
  await title.fill("議題1について");
  await page.keyboard.press("Enter");
  await page.getByTestId("ChatBlock.messageInput").fill("最初の意見");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ChatBlock.messageRow")).toHaveCount(1);

  // Folded: the title alone; kept after a reload.
  await page.getByTestId("ChatBlock.foldButton").click();
  await expect(page.getByTestId("ChatBlock.foldButton")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("ChatBlock.log")).toHaveCount(0);
  await expect(page.getByTestId("ChatBlock.form")).toHaveCount(0);
  await expect(page.getByTestId("ChatBlock.lockButton")).toHaveCount(0);
  await expect(title).toHaveValue("議題1について");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId("ChatBlock.titleInput")).toHaveValue("議題1について");
  await expect(page.getByTestId("ChatBlock.log")).toHaveCount(0);

  // The title is everyone's; folding is each viewer's own.
  const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
  try {
    const viewer = await viewerContext.newPage();
    await openPage(viewer, id);
    await expect(viewer.getByTestId("ChatBlock.title")).toHaveText("議題1について");
    await expect(viewer.getByTestId("ChatBlock.titleInput")).toHaveCount(0);
    await expect(viewer.getByTestId("ChatBlock.messageRow")).toHaveCount(1);
    await viewer.getByTestId("ChatBlock.foldButton").click();
    await expect(viewer.getByTestId("ChatBlock.log")).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }

  await page.getByTestId("ChatBlock.foldButton").click();
  await expect(page.getByTestId("ChatBlock.messageRow")).toHaveCount(1);
  await expect(page.getByTestId("ChatBlock.form")).toBeVisible();
  await trashOpenPage(page);
});
