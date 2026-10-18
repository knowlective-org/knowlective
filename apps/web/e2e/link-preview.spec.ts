import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, pasteText, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("Link previews", () => {
  test("a URL pasted into an empty line becomes a card", async ({ page }) => {
    await createPage(page, "E2E リンク");
    // The server refuses to fetch its own (non-public) address, so the card
    // keeps showing the URL: no network is needed for this test.
    await pasteText(page, "http://127.0.0.1:3000/login");

    const card = page.getByTestId("LinkPreviewBlock.link");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("href", "http://127.0.0.1:3000/login");
    await expect(card).toHaveAttribute("target", "_blank");
    await expect(card).toHaveAttribute("rel", /noopener/);
    await expect(card).toContainText("127.0.0.1:3000");

    // Back to an ordinary link.
    await page.getByTestId("LinkPreviewBlock.unwrapButton").click();
    await expect(page.getByTestId("LinkPreviewBlock")).toHaveCount(0);
    await expect(editorBody(page).locator('a[href="http://127.0.0.1:3000/login"]')).toBeVisible();
    await trashOpenPage(page);
  });

  test("a pasted YouTube URL becomes a player in the page", async ({ page }) => {
    await createPage(page, "E2E 動画");
    await pasteText(page, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s");

    const player = page.getByTestId("VideoEmbedBlock.player");
    await expect(player).toBeVisible();
    // The frame points at the video site's player, built from the id alone.
    await expect(player).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=65");
    await expect(player).toHaveAttribute("sandbox", /allow-scripts/);
    await expect(page.getByTestId("VideoEmbedBlock.link")).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s",
    );
    // Not also a link preview card.
    await expect(page.getByTestId("LinkPreviewBlock")).toHaveCount(0);

    // On paper the player is left out and the link stays.
    await page.emulateMedia({ media: "print" });
    await expect(player).toBeHidden();
    await expect(page.getByTestId("VideoEmbedBlock.link")).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await trashOpenPage(page);
  });

  test("a pasted video file URL becomes a video block", async ({ page }) => {
    await createPage(page, "E2E 動画ファイル");
    await pasteText(page, "https://example.com/media/clip.mp4");
    const video = editorBody(page).locator('[data-content-type="video"] video');
    await expect(video).toHaveAttribute("src", "https://example.com/media/clip.mp4");
    await expect(page.getByTestId("VideoEmbedBlock")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("a URL pasted mid-sentence doesn't become a card", async ({ page }) => {
    await createPage(page, "E2E リンク 文中");
    await typeInBody(page, "参考: ");
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://example.com/doc");
      document
        .querySelector(".bn-editor")!
        .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(editorBody(page)).toContainText("https://example.com/doc");
    await expect(page.getByTestId("LinkPreviewBlock")).toHaveCount(0);
    await trashOpenPage(page);
  });
});