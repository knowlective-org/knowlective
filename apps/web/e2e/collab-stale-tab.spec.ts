import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// A tab whose editor missed a remote change (issue #41: long-open tabs) must
// not write deleted blocks back: before the guard (components/editor/
// sync-guard.ts), its next edit inserted them again as new blocks, once per
// such tab. Here the tab is made stale by detaching y-prosemirror's observer.
test.use({ storageState: authFile("editor") });

const blockTypes = (page: Page) =>
  editorBody(page).evaluate((e) => [...e.querySelectorAll(".bn-block-content")].map((b) => b.getAttribute("data-content-type")));

test("a stale tab redraws from the shared document instead of bringing deleted blocks back", async ({ page, context }) => {
  const { id } = await createPage(page, "E2E stale tab");
  await editorBody(page).click();
  await page.keyboard.type("before");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/カレンダー");
  await page.getByRole("option", { name: /子ページカレンダー/ }).click();
  await page.getByTestId("ChildCalendarBlock.createDateButton").click();
  await expect(page.getByTestId("ChildCalendarBlock.monthStatus")).toBeVisible();

  const other = await context.newPage();
  await openPage(other, id);
  await expect(other.getByTestId("ChildCalendarBlock.monthStatus")).toBeVisible();

  // This tab stops hearing remote changes.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (document.querySelector(".ProseMirror") as any).editor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const binding = editor.state.plugins.find((p: any) => p.key === "y-sync$").getState(editor.state).binding;
    binding.type.unobserveDeep(binding._observeFunction);
  });
  // Deleted in the other tab, which this one doesn't hear.
  await other.getByTestId("ChildCalendarBlock.monthStatus").click();
  await other.keyboard.press("Delete");
  await expect(other.getByTestId("ChildCalendarBlock")).toHaveCount(0);

  // An edit here: the calendar isn't written back; this tab is redrawn instead
  // (here, or already when the window got the focus back).
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.querySelector(".ProseMirror") as any).editor.commands.insertContent("x");
  });
  await expect(page.getByTestId("ChildCalendarBlock")).toHaveCount(0);
  await other.waitForTimeout(1000);
  await expect(other.getByTestId("ChildCalendarBlock")).toHaveCount(0);
  expect(await blockTypes(other)).not.toContain("childCalendar");

  await other.close();
  await trashOpenPage(page);
});
