import { type Browser, type Page, expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// Notifications: the editor does things, the admin is told (the list, the
// sidebar's count). Desktop notifications themselves need a push service, so
// only their setup is tested here.

test.use({ storageState: authFile("editor") });

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ storageState: authFile("admin") });
  return { context, page: await context.newPage() };
}

// The admin's notifications about `title`, once there are `count` of them
// (the collab server notices TODOs, mentions and changes when it stores the
// page, a few seconds after the edit).
async function adminNotifications(admin: Page, title: string, count: number) {
  const items = admin.getByTestId("NotificationsPage.itemLink").filter({ hasText: title });
  await expect(async () => {
    await admin.goto("notifications");
    await expect(items).toHaveCount(count, { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  return items;
}

test("following a page: someone else's change is notified, once until the page is opened", async ({ page, browser }) => {
  const { id, title } = await createPage(page, "E2E 通知 フォロー");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  const { context, page: admin } = await adminPage(browser);
  try {
    await openPage(admin, id);
    await admin.getByTestId("PageView.followButton").click();
    await expect(admin.getByTestId("PageView.followButton")).toHaveAttribute("aria-pressed", "true");

    await editorBody(page).click();
    await page.keyboard.type("変更しました");
    const items = await adminNotifications(admin, title, 1);
    await expect(items.first()).toHaveAttribute("data-kind", "PAGE_CHANGED");
    await expect(items.first()).toContainText(ACCOUNTS.editor.name);
    await expect(admin.getByTestId("Sidebar.unreadStatus")).toBeVisible();

    // More changes before it's opened: no second one.
    await page.keyboard.type("、さらに");
    await page.waitForTimeout(4000);
    await adminNotifications(admin, title, 1);

    // Opened: read.
    await items.first().click();
    await expect(editorBody(admin)).toBeVisible();
    await admin.goto("notifications");
    await expect(admin.getByTestId("NotificationsPage.itemLink").filter({ hasText: title }).first()).toHaveAttribute("data-read", "true");
  } finally {
    await context.close();
  }
  await trashOpenPage(page);
});

test("a mention, a TODO and a chat message notify the people they're about", async ({ page, browser }) => {
  const { id, title } = await createPage(page, "E2E 通知 メンション");
  const { context, page: admin } = await adminPage(browser);
  try {
    // A mention from the "@" menu.
    await editorBody(page).click();
    await page.keyboard.type("確認お願いします @E2E 管");
    await page.getByRole("option", { name: ACCOUNTS.admin.name }).click();
    await expect(editorBody(page).getByTestId("Mention")).toHaveText(`@${ACCOUNTS.admin.name}`);

    // A TODO given to the admin.
    await page.keyboard.press("Enter");
    await page.keyboard.type("/todo");
    await page.getByRole("option", { name: /TODO/ }).click();
    await page.keyboard.type("資料を確認");
    await page.getByTestId("TodoBlock.assigneeSelect").selectOption({ label: ACCOUNTS.admin.name });

    const items = await adminNotifications(admin, title, 2);
    const kinds = await items.evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")).sort());
    expect(kinds).toEqual(["MENTION", "TODO_ASSIGNED"]);
    await expect(items.and(admin.locator('[data-kind="MENTION"]'))).toContainText("確認お願いします");

    // A chat: the admin (mentioned on the page) is told of a new message.
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/チャット");
    await page.getByRole("option", { name: /チャット/ }).first().click();
    await page.getByTestId("ChatBlock.messageInput").fill("見てください");
    await page.getByTestId("ChatBlock.sendButton").click();
    const all = await adminNotifications(admin, title, 3);
    await expect(all.and(admin.locator('[data-kind="CHAT_MESSAGE"]'))).toContainText("見てください");

    // Stored encrypted: the excerpt isn't in the table.
    const rows = await withPrisma((prisma) => prisma.notification.findMany({ where: { pageId: id } }));
    for (const row of rows) expect(Buffer.from(row.excerptEnc ?? []).toString("utf8")).not.toContain("見てください");
  } finally {
    await context.close();
  }
  await trashOpenPage(page);
});

test("someone who turned a kind off isn't told of it", async ({ page, browser }) => {
  const { context, page: admin } = await adminPage(browser);
  try {
    await admin.goto("account");
    const form = admin.getByTestId("NotificationPrefsForm");
    await form.locator('[data-ui="NotificationPrefsForm.kindCheckbox"][data-id="MENTION"]').uncheck();
    await form.getByTestId("NotificationPrefsForm.submitButton").click();
    await expect(form.getByTestId("NotificationPrefsForm.status")).toHaveText("保存しました。");

    const { id, title } = await createPage(page, "E2E 通知 オフ");
    await editorBody(page).click();
    await page.keyboard.type("@E2E 管");
    await page.getByRole("option", { name: ACCOUNTS.admin.name }).click();
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    // Stored (and checked) by now.
    await page.waitForTimeout(6000);
    expect(await withPrisma((prisma) => prisma.notification.count({ where: { pageId: id } }))).toBe(0);
    await admin.goto("notifications");
    await expect(admin.getByTestId("NotificationsPage.itemLink").filter({ hasText: title })).toHaveCount(0);
    await trashOpenPage(page);
  } finally {
    await admin.goto("account");
    const form = admin.getByTestId("NotificationPrefsForm");
    await form.locator('[data-ui="NotificationPrefsForm.kindCheckbox"][data-id="MENTION"]').check();
    await form.getByTestId("NotificationPrefsForm.submitButton").click();
    await expect(form.getByTestId("NotificationPrefsForm.status")).toHaveText("保存しました。");
    await context.close();
  }
});

test("all off: nothing is notified, and the choices of kinds are kept", async ({ page, browser }) => {
  const { context, page: admin } = await adminPage(browser);
  const form = admin.getByTestId("NotificationPrefsForm");
  const save = async () => {
    await form.getByTestId("NotificationPrefsForm.submitButton").click();
    await expect(form.getByTestId("NotificationPrefsForm.status")).toHaveText("保存しました。");
  };
  try {
    await admin.goto("account");
    await form.getByTestId("NotificationPrefsForm.enabledCheckbox").uncheck();
    await expect(form.locator('[data-ui="NotificationPrefsForm.kindCheckbox"][data-id="MENTION"]')).toBeDisabled();
    await save();

    const { id } = await createPage(page, "E2E 通知 すべてオフ");
    await editorBody(page).click();
    await page.keyboard.type("@E2E 管");
    await page.getByRole("option", { name: ACCOUNTS.admin.name }).click();
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.waitForTimeout(6000);
    expect(await withPrisma((prisma) => prisma.notification.count({ where: { pageId: id } }))).toBe(0);
    await trashOpenPage(page);

    // Back on: each kind as it was.
    await admin.reload();
    await expect(form.getByTestId("NotificationPrefsForm.enabledCheckbox")).not.toBeChecked();
    await form.getByTestId("NotificationPrefsForm.enabledCheckbox").check();
    await expect(form.locator('[data-ui="NotificationPrefsForm.kindCheckbox"][data-id="MENTION"]')).toBeChecked();
  } finally {
    await admin.goto("account");
    await form.getByTestId("NotificationPrefsForm.enabledCheckbox").check();
    await save();
    await context.close();
  }
});

// The address a desktop notification is sent to comes from the browser: only
// the browsers' push services are kept (the server sends a request there).
test("a desktop notification address that isn't a push service's is refused", async ({ page, baseURL }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") scripts.push(res.text().catch(() => ""));
  });
  await page.goto("account");
  await expect(page.getByTestId("NotificationSection")).toBeVisible();
  const source = (await Promise.all(scripts)).join("\n");
  const actionId = source.match(/"([0-9a-f]{40,})"[^"]*(?:"[^"]*"[^"]*){0,4}?"savePushSubscription"/)?.[1];
  expect(actionId, "savePushSubscription's action id").toBeTruthy();
  const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
  const count = () => withPrisma((prisma) => prisma.pushSubscription.count());
  const before = await count();
  for (const endpoint of ["http://127.0.0.1:3000/api/health", "https://169.254.169.254/latest/meta-data", "https://example.com/push"]) {
    await page.request.post("account", {
      headers: { "Next-Action": actionId!, Origin: new URL(baseURL!).origin, "Content-Type": "text/plain;charset=UTF-8" },
      data: JSON.stringify([{ endpoint, keys }]),
      maxRedirects: 0,
    });
  }
  expect(await count()).toBe(before);
  // The service worker that shows them is served.
  const sw = await page.request.get("sw.js");
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain("showNotification");
});
