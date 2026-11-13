import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// Files sent with a chat message: uploaded as the page's attachments, shown
// in the message (images as pictures), kept while the message is.
test.use({ storageState: authFile("editor") });

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("images and files can be sent in a chat, with or without text, and go when the message is taken back", async ({ page }) => {
  const { id } = await createPage(page, "E2E チャットの添付");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/チャット");
  await page.getByRole("option", { name: /チャット/ }).first().click();
  await expect(page.getByTestId("ChatBlock.empty")).toBeVisible();
  await expect(page.getByTestId("ChatBlock.attachButton")).toBeVisible();

  await page.getByTestId("ChatBlock.fileInput").setInputFiles([
    { name: "dot.png", mimeType: "image/png", buffer: PNG },
    { name: "memo.txt", mimeType: "text/plain", buffer: Buffer.from("添付のメモ") },
  ]);
  const pending = page.getByTestId("ChatBlock.pendingFile");
  await expect(pending).toHaveCount(2);
  await expect(page.locator('[data-ui="ChatBlock.pendingFile"][aria-busy="true"]')).toHaveCount(0);
  // One taken off before sending.
  await pending.filter({ hasText: "memo.txt" }).getByTestId("ChatBlock.removeFileButton").click();
  await expect(pending).toHaveCount(1);
  // Pasted into the box: added too.
  await page.getByTestId("ChatBlock.messageInput").click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["資料の中身"], "report.txt", { type: "text/plain" }));
    document
      .querySelector('[data-ui="ChatBlock.messageInput"]')!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(pending).toHaveCount(2);
  await expect(page.locator('[data-ui="ChatBlock.pendingFile"][aria-busy="true"]')).toHaveCount(0);
  // Nothing went into the page itself.
  await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(0);

  // Sent with no text.
  await page.getByTestId("ChatBlock.sendButton").click();
  const row = page.getByTestId("ChatBlock.messageRow").first();
  await expect(row.getByTestId("ChatBlock.imageLink").locator("img")).toHaveAttribute("alt", "dot.png");
  await expect(row.getByTestId("ChatBlock.fileLink")).toContainText("report.txt");
  await expect(row.getByTestId("ChatBlock.text")).toHaveCount(0);
  await expect(pending).toHaveCount(0);

  // The image is served (to whoever can open the page).
  const src = await row.getByTestId("ChatBlock.imageLink").locator("img").getAttribute("src");
  expect((await page.request.get(src!)).status()).toBe(200);

  // Kept from the clean-up of unused files while the message has them.
  const message = await withPrisma((prisma) => prisma.chatMessage.findFirstOrThrow({ where: { pageId: id } }));
  expect(message.attachmentIds).toHaveLength(2);
  const refs = await withPrisma((prisma) => prisma.pageFileRefs.findUniqueOrThrow({ where: { pageId: id } }));
  expect(refs.fileIds).toEqual(expect.arrayContaining(message.attachmentIds));

  // Taken back: the files go with it.
  await row.getByTestId("ChatBlock.deleteButton").click();
  await page.getByTestId("AppDialog.confirmButton").click();
  await expect(row.getByTestId("ChatBlock.unsentStatus")).toBeVisible();
  await expect(row.getByTestId("ChatBlock.files")).toHaveCount(0);
  const after = await withPrisma((prisma) => prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } }));
  expect(after.attachmentIds).toEqual([]);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
