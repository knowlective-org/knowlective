// Renders the app icons from src/app/icon.svg (app/manifest.ts, and the
// iPhone home screen icon). Run after changing the icon:
//   pnpm --filter web exec node scripts/app-icons.mjs
// Uses the Playwright browser of the end-to-end tests.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(web, "src/app/icon.svg"));
const src = `data:image/svg+xml;base64,${svg.toString("base64")}`;
// The icon's own background, for the icons that must be opaque.
const BACKGROUND = "#f5f1d9";

// File, size, padding on each side (a fraction of the size), background
// (null: transparent). A maskable icon is cut to a circle or a rounded
// square, so its picture keeps to the middle.
const ICONS = [
  ["public/icons/icon-192.png", 192, 0.06, null],
  ["public/icons/icon-512.png", 512, 0.06, null],
  ["public/icons/icon-maskable-512.png", 512, 0.14, BACKGROUND],
  ["src/app/apple-icon.png", 180, 0.08, BACKGROUND],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, size, padding, background] of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - 2 * padding));
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${background ?? "transparent"}">` +
        `<img src="${src}" width="${inner}" height="${inner}"></body>`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: path.join(web, file), omitBackground: !background });
    console.log(`${file} (${size}px)`);
  }
} finally {
  await browser.close();
}
