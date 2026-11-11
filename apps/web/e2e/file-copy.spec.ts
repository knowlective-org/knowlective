import { expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { createPage, editorBody, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// A 1×1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// A file is served to those who can open the page it was uploaded on. A block
// copied from a page others can't open (here, the editor's own root) showed
// its file to the editor only; the page now gets a copy of its own
// (lib/file-copy.ts) when someone who can edit it has it open.
test.describe("Attachments of blocks copied from other pages", () => {
  test("become the page's own, so its viewers can open them", async ({ page, browser }) => {
    // An image uploaded on the editor's own root page, which nobody else can open.
    const personalPageId = await withPrisma(async (prisma) => {
      const user = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email) });
      const root = await prisma.knowledgeRoot.findUniqueOrThrow({ where: { ownerId: user.id } });
      return root.rootPageId!;
    });
    const upload = await page.request.post(`api/files?pageId=${encodeURIComponent(personalPageId)}`, {
      multipart: { file: { name: "copied.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") } },
    });
    expect(upload.status()).toBe(201);
    const sourceUrl = ((await upload.json()) as { url: string }).url;
    const sourceId = sourceUrl.split("/").pop()!;

    const { id } = await createPage(page, "E2E 添付ファイルのコピー");
    // The block as HTML pasted from the other page's tab (an absolute URL).
    await editorBody(page).click();
    await page.keyboard.press("Control+End");
    await page.evaluate((src) => {
      const data = new DataTransfer();
      data.setData("text/html", `<img src="${src}" alt="copied">`);
      document
        .querySelector(".bn-editor")!
        .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, new URL(sourceUrl.slice(1), page.url().replace(/pages\/[^/]+$/, "")).href);

    // A copy as this page's own, and the block shows it.
    await expect
      .poll(() => withPrisma((prisma) => prisma.fileObject.findFirst({ where: { pageId: id, copiedFromId: sourceId } })), {
        timeout: 20_000,
      })
      .not.toBeNull();
    const copy = await withPrisma((prisma) =>
      prisma.fileObject.findFirstOrThrow({ where: { pageId: id, copiedFromId: sourceId } }),
    );
    expect(copy.name).toBe("copied.png");
    const image = editorBody(page).locator('[data-content-type="image"] img');
    await expect(image).toHaveAttribute("src", new RegExp(`/api/files/${copy.id}$`));
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // A viewer of the page opens the copy, not the original.
    const viewer = await browser.newContext({ storageState: authFile("viewer") });
    try {
      expect((await viewer.request.get(`api/files/${copy.id}`)).status()).toBe(200);
      expect((await viewer.request.get(`api/files/${sourceId}`)).status()).toBe(404);
      // Opening the page as a viewer copies nothing more (only editors do).
      const viewerPage = await viewer.newPage();
      await viewerPage.goto(`pages/${id}`);
      await expect(viewerPage.locator('[data-content-type="image"] img')).toHaveAttribute(
        "src",
        new RegExp(`/api/files/${copy.id}$`),
      );
    } finally {
      await viewer.close();
    }
    expect(await withPrisma((prisma) => prisma.fileObject.count({ where: { pageId: id } }))).toBe(1);

    await trashOpenPage(page);
  });
});
