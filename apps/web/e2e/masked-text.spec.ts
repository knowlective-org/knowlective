import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

const SECRET = "口座 9876-5432 は秘密";

test("masked text is locked with a passphrase; only the sealed form is in the page", async ({ page, browser }) => {
  const { id } = await createPage(page, "E2E 鍵でマスク");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/マスク");
  await page.getByRole("option", { name: /鍵でマスク/ }).click();

  const block = page.getByTestId("MaskedBlock");
  await block.getByTestId("MaskedBlock.textInput").fill(SECRET);
  await block.getByTestId("MaskedBlock.newPassphraseInput").fill("合言葉-1");
  await block.getByTestId("MaskedBlock.confirmPassphraseInput").fill("違う");
  await block.getByTestId("MaskedBlock.sealButton").click();
  await expect(block.getByTestId("MaskedBlock.error")).toHaveText("合言葉が一致しません。");
  await block.getByTestId("MaskedBlock.confirmPassphraseInput").fill("合言葉-1");
  await block.getByTestId("MaskedBlock.sealButton").click();
  await expect(block.getByTestId("MaskedBlock.text")).toHaveText(SECRET);

  // Hidden again: the text is gone from the screen.
  await block.getByTestId("MaskedBlock.lockButton").click();
  await expect(block.getByTestId("MaskedBlock.passphraseInput")).toBeVisible();
  await expect(editorBody(page)).not.toContainText(SECRET);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1500);

  // Opened again, the page holds only the sealed string: the text is nowhere
  // until the passphrase is typed.
  await page.reload();
  await expect(page.getByTestId("MaskedBlock.passphraseInput")).toBeVisible();
  expect(await page.content()).not.toContain(SECRET);

  // Someone else with the page: a wrong passphrase doesn't open it, the right one does.
  const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
  try {
    const viewer = await viewerContext.newPage();
    await openPage(viewer, id);
    const theirs = viewer.getByTestId("MaskedBlock");
    await theirs.getByTestId("MaskedBlock.passphraseInput").fill("まちがい");
    await theirs.getByTestId("MaskedBlock.unlockButton").click();
    await expect(theirs.getByTestId("MaskedBlock.error")).toHaveText("合言葉が違います。");
    await theirs.getByTestId("MaskedBlock.passphraseInput").fill("合言葉-1");
    await theirs.getByTestId("MaskedBlock.unlockButton").click();
    await expect(theirs.getByTestId("MaskedBlock.text")).toHaveText(SECRET);
    // View only: no editing.
    await expect(theirs.getByTestId("MaskedBlock.editButton")).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
  await trashOpenPage(page);
});
