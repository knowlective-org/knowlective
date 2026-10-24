import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { withPrisma } from "./db";
import { openPage } from "./helpers";

// The top left of the sidebars: the site's name (Newsreader) or an SVG logo,
// set in the admin console's overview. The cleanup goes back to the default.

const LOGO = readFileSync(path.join(__dirname, "../src/app/icon.svg"));
const svgFile = (name: string, content: string | Buffer) => ({
  name,
  mimeType: "image/svg+xml",
  buffer: typeof content === "string" ? Buffer.from(content) : content,
});

test.use({ storageState: authFile("admin") });

test.afterEach(async () => {
  await withPrisma((prisma) => prisma.brandSettings.deleteMany({}));
});

test("the top left shows the site's name or its logo, as set in the admin console", async ({ page, browser }) => {
  // By default: "KNOWLECTIVE" in Newsreader 600.
  await openAdmin(page);
  const brandName = page.getByTestId("AdminSidebar").getByTestId("Brand.name");
  await expect(brandName).toHaveText("KNOWLECTIVE");
  const font = await brandName.evaluate((el) => getComputedStyle(el));
  expect(font.fontFamily).toMatch(/newsreader/i);
  expect(font.fontWeight).toBe("600");
  // "powered by" only once it's no longer the default.
  const poweredBy = page.getByTestId("AdminSidebar").getByTestId("Brand.poweredBy");
  await expect(poweredBy).toHaveCount(0);

  // A name of our own.
  await page.getByTestId("BrandForm.nameInput").fill("E2E ナレッジ");
  await page.getByTestId("BrandForm.submitButton").click();
  await expect(page.getByTestId("BrandForm.status")).toHaveText("保存しました。");
  await expect(brandName).toHaveText("E2E ナレッジ");
  await expect(poweredBy).toHaveText("powered by KNOWLECTIVE");

  // A logo: an SVG with a script is refused…
  await page.locator('[data-ui="BrandForm.modeRadio"][data-id="IMAGE"]').check();
  await page
    .getByTestId("BrandForm.logoInput")
    .setInputFiles(svgFile("bad.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  await page.getByTestId("BrandForm.submitButton").click();
  await expect(page.getByTestId("BrandForm.status")).toContainText("使えません");

  // …a plain drawing is shown, to everyone.
  await page.getByTestId("BrandForm.logoInput").setInputFiles(svgFile("logo.svg", LOGO));
  await page.getByTestId("BrandForm.submitButton").click();
  await expect(page.getByTestId("BrandForm.status")).toHaveText("保存しました。");
  const logo = page.getByTestId("AdminSidebar").getByTestId("Brand.logo");
  await expect(logo).toHaveAttribute("alt", "E2E ナレッジ");
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Served so that nothing in it can run, even opened directly.
  const response = await page.request.get((await logo.getAttribute("src"))!);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  expect(response.headers()["content-security-policy"]).toContain("sandbox");

  const editor = await browser.newContext({ storageState: authFile("editor") });
  const editorPage = await editor.newPage();
  await openPage(editorPage, HOME_PAGE_ID);
  await expect(editorPage.getByTestId("Sidebar").getByTestId("Brand.logo")).toBeVisible();
  await editor.close();
});
