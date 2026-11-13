import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// Quoting selected text of a chat message, with the mouse as a person does it
// (chat-replies.spec.ts sets the selection by script): the button keeps the
// selection when pressed, a triple click (which ends past the text) still
// offers it, and over one's own message it's inverted to be seen.
test.use({ storageState: authFile("editor") });

async function chatWithMessage(page: Page, text: string) {
  await createPage(page, "E2E チャットの引用");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/チャット");
  await page.getByRole("option", { name: /チャット/ }).first().click();
  await expect(page.getByTestId("ChatBlock.empty")).toBeVisible();
  await page.getByTestId("ChatBlock.messageInput").fill(text);
  await page.keyboard.press("Enter");
  return page.getByTestId("ChatBlock.messageRow").first().getByTestId("ChatBlock.text");
}

test("quoting a selection with the mouse works, after a triple click too; inverted on one's own message", async ({ page }) => {
  const text = await chatWithMessage(page, "明日の会議は10時からです");
  const input = page.getByTestId("ChatBlock.messageInput");
  const button = page.getByTestId("ChatBlock.quoteSelectionButton");

  // A triple click selects the whole text (and ends past it).
  await text.click({ clickCount: 3 });
  await expect(button).toBeVisible();
  // Own message (primary-colored bubble): the button is inverted.
  const colors = await button.evaluate((el) => {
    const style = getComputedStyle(el);
    const bubble = getComputedStyle(el.closest('[data-ui="ChatBlock"]')!.querySelector('[data-ui="ChatBlock.text"]')!);
    return { button: style.backgroundColor, bubble: bubble.backgroundColor };
  });
  expect(colors.button).not.toBe(colors.bubble);
  // Pressed and released with the mouse (the press once cleared the selection, and the button with it).
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(input).toHaveValue("> 明日の会議は10時からです\n");
  await expect(page.getByTestId("ChatBlock.replyingStatus")).toContainText("明日の会議");
  await page.getByTestId("ChatBlock.cancelReplyButton").click();
  await input.fill("");

  // A part, dragged over with the mouse.
  const t = (await text.boundingBox())!;
  await page.mouse.move(t.x + 4, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(button).toBeVisible();
  const selected = await page.evaluate(() => getSelection()!.toString());
  expect(selected.length).toBeGreaterThan(0);
  await button.click();
  await expect(input).toHaveValue(`> ${selected.trim()}\n`);

  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
