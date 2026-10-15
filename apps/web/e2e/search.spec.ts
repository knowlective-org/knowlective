import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("検索", () => {
  test("文章のような検索語では、同じ語がなくても意味の近いページが見つかる", async ({ page }) => {
    // Pages are embedded in the background once edits settle (and the model
    // may still be loading on a fresh server).
    test.setTimeout(180_000);
    const { id } = await createPage(page, "E2E 休暇の手続き");
    await typeInBody(page, "有給休暇を取得するには、前日までに勤怠システムで申請し、上長の承認を受けてください。");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Not one word in common with the page.
    const question = "休みを取りたいときはどうすればいい";
    const result = page.locator(`[data-ui="SearchPage.result"][data-id="${id}"]`);
    await expect
      .poll(
        async () => {
          await page.goto(`search?q=${encodeURIComponent(question)}`);
          return result.count();
        },
        { timeout: 150_000, intervals: [3_000] },
      )
      .toBe(1);
    await expect(page.getByTestId("SearchPage.status")).toHaveAttribute("data-mode", "semantic");
    await expect(result).toContainText("意味が近い");

    // The same query by its words alone finds nothing.
    await page.getByTestId("SearchPage.switchModeLink").click();
    await expect(page.getByTestId("SearchPage.status")).toHaveAttribute("data-mode", "keyword");
    await expect(result).toHaveCount(0);

    await page.goto(`pages/${id}`);
    await trashOpenPage(page);
  });

  test("短い語や型番は、そのまま探す", async ({ page }) => {
    for (const q of ["議事録", "ABC-123", "「申請方法について」"]) {
      await page.goto(`search?q=${encodeURIComponent(q)}`);
      await expect(page.getByTestId("SearchPage.status")).toHaveAttribute("data-mode", "keyword");
    }
  });
});
