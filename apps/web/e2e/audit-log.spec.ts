import { expect, test } from "@playwright/test";
import { openAdmin } from "./admin-login";

// 変更の記録 in /admin (セキュリティ): 20 entries a page, newest first.

test.describe("変更の記録", () => {
  test("20件ずつページ送りで見られる", async ({ page }) => {
    await openAdmin(page, "/security");
    const rows = page.getByTestId("AdminSecurityPage.auditLogRow");
    const range = page.getByTestId("AdminSecurityPage.auditRange");
    const total = Number(/全 (\d+) 件/.exec((await range.textContent()) ?? "")?.[1] ?? 0);
    test.skip(total <= 20, "記録が20件以下のため、ページ送りがない");

    await expect(rows).toHaveCount(20);
    await expect(range).toContainText("1〜20 件目");
    await expect(page.getByTestId("Pagination.current")).toHaveText("1");
    const firstOnPage1 = await rows.first().getAttribute("data-id");

    await page.getByTestId("Pagination.nextLink").click();
    await expect(page).toHaveURL(/auditPage=2/);
    await expect(page.getByTestId("Pagination.current")).toHaveText("2");
    await expect(range).toContainText("21〜");
    await expect(rows.first()).not.toHaveAttribute("data-id", firstOnPage1!);
    expect(await rows.count()).toBeLessThanOrEqual(20);

    // Back to the first page; out-of-range pages land on the last one.
    await page.getByTestId("Pagination.prevLink").click();
    await expect(rows.first()).toHaveAttribute("data-id", firstOnPage1!);
    await page.goto("admin/security?auditPage=99999");
    await expect(page.getByTestId("Pagination.current")).toHaveText(String(Math.ceil(total / 20)));
  });
});
