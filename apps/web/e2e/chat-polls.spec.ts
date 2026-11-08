import { type Browser, type Page, expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// Polls in chat blocks: named votes, changed until the author closes the
// poll; a lock stops voting but keeps the votes; taking the poll back deletes
// it with its votes; its question and choices are searched.
test.use({ storageState: authFile("editor") });

async function insertChat(page: Page) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/チャット");
  await page.getByRole("option", { name: /チャット/ }).first().click();
  await expect(page.getByTestId("ChatBlock.empty")).toBeVisible();
}

async function postPoll(page: Page, question: string, options: string[], multiple = false) {
  await page.getByTestId("ChatBlock.pollButton").click();
  await page.getByTestId("ChatBlock.pollQuestionInput").fill(question);
  for (const [i, option] of options.entries()) {
    if (i >= 2) await page.getByTestId("ChatBlock.pollAddOptionButton").click();
    await page.locator(`[data-ui="ChatBlock.pollOptionInput"][data-id="${i}"]`).fill(option);
  }
  if (multiple) await page.getByTestId("ChatBlock.pollMultipleCheckbox").check();
  await page.getByTestId("ChatBlock.pollSubmitButton").click();
  await expect(page.getByTestId("ChatBlock.pollForm")).toHaveCount(0);
}

const option = (page: Page, i: number) => page.locator(`[data-ui="ChatBlock.pollOptionButton"][data-id="${i}"]`);

test("a poll: named votes, changed until it's closed; a lock stops voting; taking it back deletes it", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { id } = await createPage(page, "E2E チャットの投票");
  await insertChat(page);
  const word = `zqpoll${Date.now()}`;
  await postPoll(page, "お昼はどこにする？", ["ラーメン", "そば", `カレー ${word}`]);
  const poll = page.getByTestId("ChatBlock.poll");
  await expect(page.getByTestId("ChatBlock.text")).toContainText("お昼はどこにする？");
  await expect(page.getByTestId("ChatBlock.pollStatus")).toHaveText("まだ投票はありません");
  // The question and choices are fixed: no "edit".
  await expect(page.getByTestId("ChatBlock.editButton")).toHaveCount(0);

  // One choice: picking another moves the vote.
  await option(page, 0).click();
  await expect(option(page, 0)).toHaveAttribute("aria-pressed", "true");
  await option(page, 1).click();
  await expect(option(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(option(page, 0)).toHaveAttribute("aria-pressed", "false");

  // Someone else votes; each sees the other's vote, with the names on hover.
  const other = await browser.newContext({ storageState: authFile("admin") });
  const otherPage = await other.newPage();
  try {
    await openPage(otherPage, id);
    await option(otherPage, 1).click();
    await expect(otherPage.getByTestId("ChatBlock.pollStatus")).toHaveText("2人が投票");
    await expect(option(page, 1)).toHaveAttribute("title", `${ACCOUNTS.editor.name}, ${ACCOUNTS.admin.name}`);
    await expect(option(page, 1).locator("span").last()).toHaveText("2");

    // Locked: the votes stay, nobody can vote.
    await page.getByTestId("ChatBlock.lockButton").click();
    await expect(otherPage.getByTestId("ChatBlock.pollOptionButton")).toHaveCount(0);
    await expect(otherPage.locator('[data-ui="ChatBlock.pollOptionRow"][data-id="1"]')).toHaveAttribute("data-mine", "true");
    await expect(page.getByTestId("ChatBlock.pollCloseButton")).toHaveCount(0);
    await page.getByTestId("ChatBlock.unlockButton").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(option(otherPage, 0)).toBeVisible();

    // Only its author can close it; then nobody can vote, for good.
    await expect(otherPage.getByTestId("ChatBlock.pollCloseButton")).toHaveCount(0);
    await page.getByTestId("ChatBlock.pollCloseButton").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(poll).toHaveAttribute("data-closed", "true");
    await expect(otherPage.getByTestId("ChatBlock.pollStatus")).toHaveText("2人が投票 · 締め切り済み");
    await expect(otherPage.getByTestId("ChatBlock.pollOptionButton")).toHaveCount(0);
    await expect(page.locator('[data-ui="ChatBlock.pollOptionRow"][data-id="1"]')).toHaveAttribute("data-top", "true");
  } finally {
    await other.close();
  }

  // Several choices per person.
  await postPoll(page, "参加できる日は？", ["月", "火", "水"], true);
  const second = page.getByTestId("ChatBlock.poll").nth(1);
  await second.locator('[data-ui="ChatBlock.pollOptionButton"][data-id="0"]').click();
  await expect(second.locator('[data-ui="ChatBlock.pollOptionButton"][data-id="0"]')).toHaveAttribute("aria-pressed", "true");
  await second.locator('[data-ui="ChatBlock.pollOptionButton"][data-id="2"]').click();
  await expect(second.locator('[data-ui="ChatBlock.pollOptionButton"][data-id="2"]')).toHaveAttribute("aria-pressed", "true");
  await expect(second.getByTestId("ChatBlock.pollStatus")).toHaveText("1人が投票 · 複数選択可");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  // Searched by its choices.
  const result = page.locator(`[data-ui="SearchPage.result"][data-id="${id}"]`);
  await expect
    .poll(
      async () => {
        await page.goto(`search?q=${word}&mode=keyword`);
        return result.count();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(1);

  // Taken back: the poll and its votes are deleted, not just hidden.
  await page.goto(`pages/${id}`);
  const first = page.getByTestId("ChatBlock.messageRow").first();
  await first.getByTestId("ChatBlock.deleteButton").click();
  await page.getByTestId("AppDialog.confirmButton").click();
  await expect(first.getByTestId("ChatBlock.unsentStatus")).toBeVisible();
  await expect(first.getByTestId("ChatBlock.poll")).toHaveCount(0);
  const messageId = (await first.getAttribute("data-id"))!;
  const left = await withPrisma(async (prisma) => ({
    polls: await prisma.chatPoll.count({ where: { messageId } }),
    votes: await prisma.chatPollVote.count({ where: { messageId } }),
  }));
  expect(left).toEqual({ polls: 0, votes: 0 });
  await trashOpenPage(page);
});

// Voting and closing, called directly: voting only for someone who can edit
// the page, closing only for the poll's author.
test("voting and closing a poll, called directly, only work for those allowed", async ({ page, browser, baseURL }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  const { id } = await createPage(page, "E2E 投票の権限");
  await insertChat(page);
  await postPoll(page, "どれにする？", ["A", "B"]);
  const messageId = (await page.getByTestId("ChatBlock.messageRow").getAttribute("data-id"))!;

  const source = (await Promise.all(scripts)).join("\n");
  const actionIdOf = (name: string) => source.match(new RegExp(`"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"${name}"`))?.[1];
  const voteId = actionIdOf("voteChatPoll");
  const closeId = actionIdOf("closeChatPoll");
  const editId = actionIdOf("editChatMessage");
  expect(voteId, "voteChatPoll's action id").toBeTruthy();
  expect(closeId, "closeChatPoll's action id").toBeTruthy();
  expect(editId, "editChatMessage's action id").toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const call = async (b: Browser, role: "guest" | "outsider" | "viewer" | "admin" | "editor", actionId: string, args: unknown[]) => {
    const context = await b.newContext({ storageState: role === "guest" ? { cookies: [], origins: [] } : authFile(role) });
    await context.request.post(`pages/${id}`, {
      headers: { "Next-Action": actionId, Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
      data: JSON.stringify(args),
      maxRedirects: 0,
    });
    await context.close();
  };
  const votes = () => withPrisma((prisma) => prisma.chatPollVote.count({ where: { messageId } }));

  for (const role of ["guest", "outsider", "viewer", "editor"] as const) {
    await call(browser, role, voteId!, [messageId, [0]]);
    expect(await votes(), role).toBe(role === "editor" ? 1 : 0);
  }
  // Two choices in a poll that takes one: refused.
  await call(browser, "admin", voteId!, [messageId, [0, 1]]);
  expect(await votes()).toBe(1);

  // Its text can't be changed, even by its author.
  await call(browser, "editor", editId!, [messageId, "書き換え"]);
  const edited = await withPrisma((prisma) => prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId }, select: { editedAt: true } }));
  expect(edited.editedAt).toBeNull();

  const closed = async () =>
    (await withPrisma((prisma) => prisma.chatPoll.findUniqueOrThrow({ where: { messageId }, select: { closedAt: true } }))).closedAt !== null;
  for (const role of ["guest", "outsider", "viewer", "admin", "editor"] as const) {
    await call(browser, role, closeId!, [messageId]);
    expect(await closed(), role).toBe(role === "editor");
  }
  // Closed: no more votes, even from someone who can edit the page.
  await call(browser, "admin", voteId!, [messageId, [1]]);
  expect(await votes()).toBe(1);
  await trashOpenPage(page);
});
