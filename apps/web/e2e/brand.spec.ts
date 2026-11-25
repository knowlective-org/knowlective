import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { withPrisma } from "./db";
import { openPage } from "./helpers";

// The top left of the sidebars: the site's name (Newsreader) or an SVG logo,
// set in the admin console's overview. The cleanup goes back to the default.

const LOGO = readFileSync(path.join(__dirname, "../public/icon.svg"));
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
  // By default: "knowlective" in Newsreader 600.
  await openAdmin(page);
  const brandName = page.getByTestId("AdminSidebar").getByTestId("Brand.name");
  await expect(brandName).toHaveText("knowlective");
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
  await expect(poweredBy).toHaveText("powered by knowlective");

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

test("the site's favicon in the tab is the one set in the admin console, for everyone, until set back to the default", async ({ page, browser }) => {
  const icon = (p: typeof page) => p.locator('head link[rel="icon"]');
  await openAdmin(page);
  await expect(icon(page)).toHaveAttribute("href", /\/icon\.svg$/);
  await expect(page.getByTestId("SiteFaviconForm.removeButton")).toHaveCount(0);

  // An SVG with a script, or something that isn't an image, is refused.
  await page
    .getByTestId("SiteFaviconForm.fileInput")
    .setInputFiles(svgFile("bad.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  await page.getByTestId("SiteFaviconForm.submitButton").click();
  await expect(page.getByTestId("SiteFaviconForm.status")).toContainText("使えません");
  await page.getByTestId("SiteFaviconForm.fileInput").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByTestId("SiteFaviconForm.submitButton").click();
  await expect(page.getByTestId("SiteFaviconForm.status")).toHaveText("PNG・ICO・SVG の画像を選んでください。");

  // A PNG: in the tab, served as it is.
  const png = readFileSync(path.join(__dirname, "../public/icons/icon-192.png"));
  await page.getByTestId("SiteFaviconForm.fileInput").setInputFiles({ name: "favicon.png", mimeType: "image/png", buffer: png });
  await page.getByTestId("SiteFaviconForm.submitButton").click();
  await expect(page.getByTestId("SiteFaviconForm.status")).toHaveText("保存しました。");
  await page.reload();
  await expect(icon(page)).toHaveAttribute("href", /\/api\/site-favicon\?v=\d+$/);
  const href = (await icon(page).getAttribute("href"))!;
  const response = await page.request.get(href);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(response.headers()["content-security-policy"]).toContain("sandbox");
  expect(Buffer.from(await response.body()).equals(png)).toBe(true);

  // The same for someone not logged in (the login screen).
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guestPage = await guest.newPage();
  await guestPage.goto("login");
  await expect(icon(guestPage)).toHaveAttribute("href", href);
  expect((await guestPage.request.get(href)).status()).toBe(200);

  // Back to the default: no longer served.
  await page.getByTestId("SiteFaviconForm.removeButton").click();
  await expect(page.getByTestId("SiteFaviconForm.status")).toHaveText("既定のアイコンに戻しました。");
  await guestPage.reload();
  await expect(icon(guestPage)).toHaveAttribute("href", /\/icon\.svg$/);
  expect((await guestPage.request.get("api/site-favicon")).status()).toBe(404);
  await guest.close();
});
