import { expect, test } from "@playwright/test";
import { ACCOUNTS, HOME_PAGE_ID, authFile } from "./accounts";
import { withPrisma } from "./db";
import { openPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// A 1×1 PNG: the browser makes it a square of its own (WebP or PNG).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

test("a picture set on the account screen is shown by the name, to people logged in only; without one, the initial", async ({ page, browser }) => {
  const editorId = await withPrisma((prisma) =>
    prisma.user.findFirstOrThrow({ where: { name: ACCOUNTS.editor.name }, select: { id: true } }).then((u) => u.id),
  );
  await withPrisma((prisma) => prisma.user.update({ where: { id: editorId }, data: { avatarEnc: null, avatarType: null, avatarUpdatedAt: null } }));
  try {
    // None yet: the first character of the name.
    await openPage(page, HOME_PAGE_ID);
    const own = page.getByTestId("Sidebar.user").getByTestId("Avatar");
    await expect(own).toHaveAttribute("data-initial", ACCOUNTS.editor.name.trim()[0].toUpperCase());

    await page.goto("account");
    const section = page.getByTestId("AvatarSection");
    await expect(section.getByTestId("AvatarSection.removeButton")).toHaveCount(0);
    // Something that isn't a picture is turned down in the browser.
    await section.getByTestId("AvatarSection.fileInput").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.from("not a picture") });
    await expect(section.getByTestId("AvatarSection.status")).toContainText("PNG・JPEG・WebP");
    await section.getByTestId("AvatarSection.fileInput").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
    await expect(section.getByTestId("AvatarSection.status")).toContainText("保存しました");
    await expect(section.getByTestId("Avatar").locator("img")).toHaveCount(1);
    const img = page.getByTestId("Sidebar.user").getByTestId("Avatar").locator("img");
    await expect(img).toHaveCount(1);
    const src = (await img.getAttribute("src"))!;
    expect(src).toMatch(new RegExp(`/api/users/${editorId}/avatar\\?v=\\d+$`));
    // Stored encrypted, a small square.
    const stored = await withPrisma((prisma) => prisma.user.findUniqueOrThrow({ where: { id: editorId }, select: { avatarType: true } }));
    expect(["image/webp", "image/png"]).toContain(stored.avatarType);

    // Another person logged in gets it; someone not logged in doesn't.
    for (const [state, status] of [[authFile("viewer"), 200], [{ cookies: [], origins: [] }, 404]] as [string | { cookies: []; origins: [] }, number][]) {
      const context = await browser.newContext({ storageState: state });
      try {
        const response = await context.request.get(new URL(src, page.url()).toString());
        expect(response.status()).toBe(status);
        if (status === 200) {
          expect(response.headers()["content-type"]).toBe(stored.avatarType);
          expect(response.headers()["x-content-type-options"]).toBe("nosniff");
        }
      } finally {
        await context.close();
      }
    }

    // Removed: the initial again.
    await section.getByTestId("AvatarSection.removeButton").click();
    await expect(section.getByTestId("Avatar").locator("img")).toHaveCount(0);
    await expect(page.getByTestId("Sidebar.user").getByTestId("Avatar")).toHaveAttribute("data-initial", ACCOUNTS.editor.name.trim()[0].toUpperCase());
    expect((await page.request.get(new URL(src, page.url()).toString())).status()).toBe(404);
  } finally {
    await withPrisma((prisma) => prisma.user.update({ where: { id: editorId }, data: { avatarEnc: null, avatarType: null, avatarUpdatedAt: null } }));
  }
});
