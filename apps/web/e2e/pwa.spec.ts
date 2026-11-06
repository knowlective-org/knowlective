import { expect, test } from "@playwright/test";

// Installing the site as an app ("Add to home screen", the browser's
// "Install"): the manifest with its icons, and the tags iPhones read. Also
// before logging in, where the login screen is what gets added.
test.describe("Installing as an app", () => {
  test("the manifest names the site and has icons that load", async ({ page, request }) => {
    await page.goto("login");
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBeTruthy();
    const manifest = await (await request.get(new URL(manifestHref!, page.url()).href)).json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBeTruthy();
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);

    const sizes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]));
    for (const icon of manifest.icons) {
      const res = await request.get(new URL(icon.src, page.url()).href);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
    }

    // iPhone and iPad: the home screen icon, the name and the bar's color.
    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect((await request.get(new URL(appleIcon!, page.url()).href)).status()).toBe(200);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", manifest.name);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", manifest.theme_color);
  });
});
