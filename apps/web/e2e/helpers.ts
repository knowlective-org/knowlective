import { type Locator, type Page, expect } from "@playwright/test";
import { HOME_PAGE_ID, PASSWORD } from "./accounts";

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("login");
  await page.getByTestId("LoginForm.emailInput").fill(email);
  await page.getByTestId("LoginForm.passwordInput").fill(password);
  await page.getByTestId("LoginForm.submitButton").click();
}

// The page's body (BlockNote), once the collaboration connection has synced.
export function editorBody(page: Page): Locator {
  return page.locator(".bn-editor");
}

export async function openPage(page: Page, pageId: string) {
  await page.goto(`pages/${pageId}`);
  await expect(editorBody(page)).toBeVisible();
}

// Adds a page under the E2E home page, titles it, and returns its id. The
// title carries a timestamp, so runs don't collide.
export async function createPage(page: Page, label: string): Promise<{ id: string; title: string }> {
  await openPage(page, HOME_PAGE_ID);
  const row = page.locator(`[data-ui="DocTree.link"][data-id="${HOME_PAGE_ID}"]`);
  // The add button only shows while its row is hovered.
  await row.hover();
  await page.locator(`[data-ui="DocTree.addChildButton"][data-id="${HOME_PAGE_ID}"]`).click();
  await page.waitForURL((url) => /\/pages\/(?!e2e-home)[^/]+$/.test(url.pathname));
  await expect(editorBody(page)).toBeVisible();
  const title = `${label} ${Date.now()}`;
  await page.getByTestId("TitleField").fill(title);
  return { id: new URL(page.url()).pathname.split("/").pop()!, title };
}

// Types into the body, starting on a new line at the end.
export async function typeInBody(page: Page, text: string) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

// Puts a file into the editor the way pasting one does (BlockNote treats a
// pasted and a dropped file the same; a paste needs no coordinates).
export async function pasteFile(page: Page, file: { name: string; type: string; base64: string }) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.evaluate(({ name, type, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], name, { type }));
    const target = document.querySelector(".bn-editor")!;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, file);
}

// Pastes plain text into the body, on a new empty line at the end.
export async function pasteText(page: Page, text: string) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const target = document.querySelector(".bn-editor")!;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

// Moves the open page to the trash through its menu.
export async function trashOpenPage(page: Page) {
  await page.getByTestId("PageMenu.button").click();
  await page.getByTestId("PageMenu.delete").click();
  await page.getByTestId("AppDialog.confirmButton").click();
  await page.waitForURL(`**/pages/${HOME_PAGE_ID}`);
}