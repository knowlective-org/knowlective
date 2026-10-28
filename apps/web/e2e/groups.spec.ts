import { expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { userWhere, withPrisma } from "./db";

// Adding members to a group in the admin console: suggestions by name or
// email address while typing, several people picked as badges, added at once.

test.use({ storageState: authFile("admin") });

const GROUP = `E2E メンバー追加 ${Date.now()}`;

test.afterAll(async () => {
  await withPrisma((prisma) => prisma.group.deleteMany({ where: { name: GROUP } }));
});

test("members are found by name or email address as you type, and several are added at once", async ({ page }) => {
  const groupId = await withPrisma(async (prisma) => (await prisma.group.create({ data: { name: GROUP } })).id);
  const [editor, viewer] = await withPrisma(async (prisma) =>
    Promise.all([
      prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } }),
      prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.viewer.email), select: { id: true } }),
    ]),
  );
  await openAdmin(page, `/groups/${groupId}`);
  const search = page.getByTestId("AddMemberForm.searchInput");
  const candidate = (id: string) => page.locator(`[data-ui="AddMemberForm.candidateItem"][data-id="${id}"]`);

  // Part of a display name (case and width don't matter), picked with a click.
  await search.fill("ｅ２ｅ 編集");
  await expect(candidate(editor.id)).toContainText(ACCOUNTS.editor.email);
  await candidate(editor.id).click();
  await expect(page.locator(`[data-ui="AddMemberForm.pickedItem"][data-id="${editor.id}"]`)).toHaveText(/E2E 編集者/);
  await expect(search).toHaveValue("");

  // Part of an email address, picked with the keyboard.
  await search.pressSequentially("viewer@exa");
  await expect(candidate(viewer.id)).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.getByTestId("AddMemberForm.pickedItem")).toHaveCount(2);

  // Someone already picked isn't suggested again; nothing matching says so.
  await search.fill("e2e-editor");
  await expect(page.getByTestId("AddMemberForm.noCandidates")).toBeVisible();
  // Backspace on an empty box drops the last badge; × drops any.
  await search.fill("");
  await search.press("Backspace");
  await expect(page.getByTestId("AddMemberForm.pickedItem")).toHaveCount(1);
  await search.fill("閲覧者");
  await candidate(viewer.id).click();

  await page.getByTestId("AddMemberForm.submitButton").click();
  await expect(page.getByTestId("AddMemberForm.status")).toHaveText("2 人を追加しました。");
  await expect(page.getByTestId("AddMemberForm.pickedItem")).toHaveCount(0);
  await expect(page.locator(`[data-ui="AdminGroupPage.memberRow"][data-id="${editor.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-ui="AdminGroupPage.memberRow"][data-id="${viewer.id}"]`)).toBeVisible();
  // Members aren't suggested any more.
  await search.fill("e2e-viewer");
  await expect(page.getByTestId("AddMemberForm.noCandidates")).toBeVisible();
  // Each addition is in the audit log.
  const logged = await withPrisma((prisma) =>
    prisma.auditLog.count({ where: { action: "group.member.add", createdAt: { gte: new Date(Date.now() - 60_000) } } }),
  );
  expect(logged).toBeGreaterThanOrEqual(2);
});
