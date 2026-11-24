import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { addPageFromTree, createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// The child page calendar: child pages on a month's calendar by a date
// column; added on a day, moved by dragging, dated from the "no date" tray.
test.use({ storageState: authFile("editor") });

async function insertCalendar(page: Page) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/カレンダー");
  await page.getByRole("option", { name: /子ページカレンダー/ }).click();
  await expect(page.getByTestId("ChildCalendarBlock")).toBeVisible();
}

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (page: Page, date: string) => page.locator(`[data-ui="ChildCalendarBlock.day"][data-id="${date}"]`);

test("child pages go on the calendar by their date: added on a day, dragged to another, dated from the tray", async ({ page }) => {
  const calendar = await createPage(page, "E2E カレンダー");
  await insertCalendar(page);

  // No date column yet: the calendar offers to make one.
  await page.getByTestId("ChildCalendarBlock.createDateButton").click();
  const now = new Date();
  await expect(page.getByTestId("ChildCalendarBlock.monthStatus")).toHaveText(`${now.getFullYear()}年${now.getMonth() + 1}月`);
  const today = local(now);
  // Another day of this month to move to.
  const other = local(new Date(now.getFullYear(), now.getMonth(), now.getDate() === 1 ? 2 : 1));
  await expect(day(page, today)).toHaveAttribute("data-today", "true");

  // Added on today.
  await day(page, today).hover();
  await day(page, today).getByTestId("ChildCalendarBlock.addButton").click();
  await page.getByTestId("ChildCalendarBlock.addInput").fill("定例会議");
  await page.keyboard.press("Enter");
  await expect(day(page, today).getByTestId("ChildCalendarBlock.card")).toHaveText("定例会議");
  await expect(page.getByTestId("ChildCalendarBlock.calendar")).toHaveAttribute("aria-busy", "false");

  // Dragged to another day (real mouse moves: a drag starts only after the
  // pointer has travelled a little).
  const card = day(page, today).getByTestId("ChildCalendarBlock.cardLink");
  const from = (await card.boundingBox())!;
  const to = (await day(page, other).boundingBox())!;
  await page.mouse.move(from.x + 4, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 24, from.y + from.height / 2 + 6, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(day(page, other).getByTestId("ChildCalendarBlock.card")).toHaveText("定例会議");
  await expect(day(page, today).getByTestId("ChildCalendarBlock.card")).toHaveCount(0);
  // The page's own text wasn't dragged along by the editor.
  await expect(editorBody(page).locator('[data-content-type="paragraph"]').filter({ hasText: "定例会議" })).toHaveCount(0);

  // Kept: still there after a reload.
  await expect(page.getByTestId("ChildCalendarBlock.calendar")).toHaveAttribute("aria-busy", "false");
  await page.reload();
  await expect(day(page, other).getByTestId("ChildCalendarBlock.card")).toHaveText("定例会議");

  // Months: next has nothing; "today" comes back.
  await page.getByTestId("ChildCalendarBlock.nextButton").click();
  await expect(page.getByTestId("ChildCalendarBlock.card")).toHaveCount(0);
  await page.getByTestId("ChildCalendarBlock.todayButton").click();
  await expect(page.getByTestId("ChildCalendarBlock.card")).toHaveCount(1);

  // A child page without a date is in the tray, and gets one there.
  await addPageFromTree(page, calendar.id);
  await page.waitForURL((url) => !url.pathname.endsWith(calendar.id));
  await page.getByTestId("TitleField").fill("日付なしのページ");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await openPage(page, calendar.id);
  const undated = page.getByTestId("ChildCalendarBlock.undated");
  await expect(undated.getByTestId("ChildCalendarBlock.card")).toHaveText("日付なしのページ");
  await undated.getByTestId("ChildCalendarBlock.dateInput").fill(today);
  await expect(day(page, today).getByTestId("ChildCalendarBlock.card")).toHaveText("日付なしのページ");
  await expect(undated).toHaveCount(0);

  // The card opens its page.
  await day(page, other).getByTestId("ChildCalendarBlock.cardLink").click();
  await expect(page.getByTestId("TitleField")).toHaveValue("定例会議");
  await openPage(page, calendar.id);
  await trashOpenPage(page);
});

test("the calendar as a Gantt chart: a week, a month or three months, with bars moved and resized", async ({ page }) => {
  test.setTimeout(120_000);
  const calendar = await createPage(page, "E2E ガント");
  await insertCalendar(page);
  await page.getByTestId("ChildCalendarBlock.createDateButton").click();
  const now = new Date();
  const today = local(now);
  const after = (n: number) => local(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  await day(page, today).hover();
  await day(page, today).getByTestId("ChildCalendarBlock.addButton").click();
  await page.getByTestId("ChildCalendarBlock.addInput").fill("設計");
  await page.keyboard.press("Enter");
  await expect(day(page, today).getByTestId("ChildCalendarBlock.card")).toHaveText("設計");

  await page.locator('[data-ui="ChildCalendarBlock.layoutButton"][data-id="gantt"]').click();
  await expect(page.getByTestId("ChildCalendarBlock.gantt")).toBeVisible();
  const days = page.getByTestId("ChildCalendarBlock.ganttDay");
  await page.locator('[data-ui="ChildCalendarBlock.rangeButton"][data-id="week"]').click();
  await expect(days).toHaveCount(7);
  await page.locator('[data-ui="ChildCalendarBlock.rangeButton"][data-id="quarter"]').click();
  expect(await days.count()).toBeGreaterThanOrEqual(89);
  // A year and three years are drawn by month, with the bar still on them.
  const months = page.getByTestId("ChildCalendarBlock.ganttMonth");
  await page.locator('[data-ui="ChildCalendarBlock.rangeButton"][data-id="year"]').click();
  await expect(months).toHaveCount(12);
  await expect(days).toHaveCount(0);
  await expect(page.getByTestId("ChildCalendarBlock.ganttBar")).toBeVisible();
  await page.locator('[data-ui="ChildCalendarBlock.rangeButton"][data-id="threeYears"]').click();
  await expect(months).toHaveCount(36);
  await expect(page.getByTestId("ChildCalendarBlock.ganttYear")).toHaveCount(3);
  await expect(page.getByTestId("ChildCalendarBlock.ganttBar")).toBeInViewport();
  await page.locator('[data-ui="ChildCalendarBlock.rangeButton"][data-id="month"]').click();
  await expect(days).toHaveCount(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());

  // One date so far: a one-day bar, until there is an end date column.
  const bar = page.getByTestId("ChildCalendarBlock.ganttBar");
  await expect(bar).toHaveAttribute("data-start", today);
  await expect(bar).toHaveAttribute("data-end", today);
  await expect(page.getByTestId("ChildCalendarBlock.ganttEndHandle")).toHaveCount(0);
  await page.getByTestId("ChildCalendarBlock.createEndButton").click();
  const handle = page.getByTestId("ChildCalendarBlock.ganttEndHandle");
  await expect(handle).toBeVisible();

  // Its end dragged two days on.
  const width = (await page.locator(`[data-ui="ChildCalendarBlock.ganttDay"][data-id="${today}"]`).boundingBox())!.width;
  const edge = (await handle.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + width * 2, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(bar).toHaveAttribute("data-end", after(2));
  await expect(page.getByTestId("ChildCalendarBlock.gantt")).toHaveAttribute("aria-busy", "false");

  // By keyboard: the whole bar a day later.
  await bar.focus();
  await page.keyboard.press("ArrowRight");
  await expect(bar).toHaveAttribute("data-start", after(1));
  await expect(bar).toHaveAttribute("data-end", after(3));
  await expect(page.getByTestId("ChildCalendarBlock.gantt")).toHaveAttribute("aria-busy", "false");

  // The view and the dates are kept.
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("ChildCalendarBlock.gantt")).toBeVisible();
  await expect(page.getByTestId("ChildCalendarBlock.ganttRow").filter({ hasText: "設計" })).toHaveCount(1);
  await expect(page.locator('[data-ui="ChildCalendarBlock.rangeButton"][data-id="month"]')).toHaveAttribute("aria-pressed", "true");

  await openPage(page, calendar.id);
  await trashOpenPage(page);
});
