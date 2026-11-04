import { expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { createPage, editorBody, openPage, pasteText, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

test("a TODO has an assignee and a due date, and keeps who completed it; it replaces the check list", async ({ page, browser }) => {
  const { id } = await createPage(page, "E2E TODO");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  // The check list is offered as a TODO, found by its old name too.
  await page.keyboard.type("/チェックリスト");
  await expect(page.getByRole("option", { name: /^チェックリスト/ })).toHaveCount(0);
  await page.getByRole("option", { name: /TODO/ }).click();
  await page.keyboard.type("資料を送る");
  // Enter continues the list.
  await page.keyboard.press("Enter");
  await page.keyboard.type("会議室を予約");
  const todos = page.getByTestId("TodoBlock");
  await expect(todos).toHaveCount(2);

  const first = todos.first();
  await first.getByTestId("TodoBlock.assigneeSelect").selectOption({ label: ACCOUNTS.editor.name });
  await first.getByTestId("TodoBlock.dueInput").fill("2020-01-31");
  await expect(first.getByTestId("TodoBlock.overdueStatus")).toHaveText("期限切れ");
  await first.getByTestId("TodoBlock.checkbox").check();
  await expect(first.getByTestId("TodoBlock.overdueStatus")).toHaveCount(0);
  await expect(first.getByTestId("TodoBlock.doneStatus")).toContainText(`${ACCOUNTS.editor.name}が`);
  // "[ ] " at the start of a line makes a TODO as well.
  // (Enter on the empty new one turns it back into a paragraph.)
  await todos.nth(1).locator(".bn-inline-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[ ] 三つ目");
  await expect(todos).toHaveCount(3);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1000);

  // Someone who can only read it sees the same, without the controls.
  const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
  try {
    const viewer = await viewerContext.newPage();
    await openPage(viewer, id);
    const done = viewer.getByTestId("TodoBlock").first();
    await expect(done.getByTestId("TodoBlock.checkbox")).toBeChecked();
    await expect(done.getByTestId("TodoBlock.checkbox")).toBeDisabled();
    await expect(done.getByTestId("TodoBlock.assignee")).toHaveText(`担当: ${ACCOUNTS.editor.name}`);
    await expect(done.getByTestId("TodoBlock.due")).toContainText("2020");
    await expect(done.getByTestId("TodoBlock.doneStatus")).toContainText(ACCOUNTS.editor.name);
    await expect(done.getByTestId("TodoBlock.assigneeSelect")).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }

  // Unticked: the record of who completed it goes.
  await page.reload();
  await page.getByTestId("TodoBlock").first().getByTestId("TodoBlock.checkbox").uncheck();
  await expect(page.getByTestId("TodoBlock").first().getByTestId("TodoBlock.doneStatus")).toHaveCount(0);
  await trashOpenPage(page);
});

test("a pasted Markdown check list becomes TODOs", async ({ page }) => {
  await createPage(page, "E2E TODO の貼り付け");
  await pasteText(page, ["- [ ] 一つ目", "- [x] 二つ目"].join("\n"));
  const todos = page.getByTestId("TodoBlock");
  await expect(todos).toHaveCount(2);
  await expect(todos.nth(1).getByTestId("TodoBlock.checkbox")).toBeChecked();
  await expect(editorBody(page).locator('[data-content-type="checkListItem"]')).toHaveCount(0);
  await trashOpenPage(page);
});

// The names for a page's TODOs, asked for directly (not from the screen):
// only for someone who can open the page. Its id is in the editor's scripts.
test("the people for a page's TODOs are only given to those who can open it", async ({ page, browser, baseURL }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  const { id } = await createPage(page, "E2E TODO の名前");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/todo");
  await page.getByRole("option", { name: /TODO/ }).click();
  await expect(page.getByTestId("TodoBlock.assigneeSelect")).toContainText(ACCOUNTS.editor.name);

  const source = (await Promise.all(scripts)).join("\n");
  const actionId = source.match(/"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"loadPagePeople"/)?.[1];
  expect(actionId, "loadPagePeople's action id").toBeTruthy();
  const origin = new URL(baseURL!).origin;
  for (const role of ["guest", "outsider", "viewer"] as const) {
    const context = await browser.newContext({ storageState: role === "guest" ? { cookies: [], origins: [] } : authFile(role) });
    const res = await context.request.post(`pages/${id}`, {
      headers: { "Next-Action": actionId!, Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
      data: JSON.stringify([id]),
      maxRedirects: 0,
    });
    const body = await res.text();
    await context.close();
    // The viewer gets the names (so the refusals mean something).
    expect(body.includes(ACCOUNTS.editor.name), role).toBe(role === "viewer");
  }
  await trashOpenPage(page);
});
