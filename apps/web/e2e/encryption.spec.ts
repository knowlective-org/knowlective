import { expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { withPrisma } from "./db";
import { attachFile, createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

// What the app encrypts never reaches the database in plain text: a page's
// body (the document, its history versions, its search index), an attached
// file's extracted text, and email addresses. Every table of the database is
// searched for them, as text and as the hex that binary columns show as.
// (Page titles and file names are stored as they are, by design.)

test.use({ storageState: authFile("editor") });

// The tables (and rows) whose text form contains `needle` or its bytes.
async function tablesContaining(needle: string): Promise<string[]> {
  const hex = Buffer.from(needle, "utf8").toString("hex");
  return withPrisma(async (prisma) => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const found: string[] = [];
    for (const { name } of tables) {
      const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${name.replaceAll('"', '""')}" x WHERE strpos(x::text, $1) > 0 OR strpos(lower(x::text), $2) > 0`,
        needle,
        hex,
      );
      if (row.n > 0) found.push(`${name} (${row.n})`);
    }
    return found;
  });
}

test("page bodies, attachment text and email addresses aren't stored in plain text", async ({ page }) => {
  const marker = `kn-plaintext-check-${Date.now()}`;
  const { id, title } = await createPage(page, "E2E 暗号化の確認");
  await typeInBody(page, `本文の印 ${marker}`);
  await attachFile(page, { name: "check.txt", type: "text/plain", base64: Buffer.from(`添付の印 ${marker}-file`).toString("base64") });
  await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(1);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  // Stored, indexed, the attachment's text read, and — once everyone has left
  // the page — saved as a history version.
  await page.goto("account");
  await expect
    .poll(
      () =>
        withPrisma(async (prisma) => {
          const [doc, index, file, versions] = await Promise.all([
            prisma.pageDocument.findUnique({ where: { pageId: id }, select: { pageId: true } }),
            prisma.pageSearchIndex.findUnique({ where: { pageId: id }, select: { pageId: true } }),
            prisma.fileObject.findFirst({ where: { pageId: id, textExtractedAt: { not: null } }, select: { id: true } }),
            prisma.pageVersion.count({ where: { pageId: id } }),
          ]);
          return !!doc && !!index && !!file && versions >= 1;
        }),
      { timeout: 60_000 },
    )
    .toBe(true);

  // Readable through the app (so the data really is there)…
  await openPage(page, id);
  await expect(editorBody(page)).toContainText(marker);
  // …but nowhere in the database as such.
  expect(await tablesContaining(marker)).toEqual([]);
  // (The search does find what is stored as it is: the title.)
  expect((await tablesContaining(title)).some((t) => t.startsWith("Page "))).toBe(true);
  for (const email of [ACCOUNTS.editor.email, ACCOUNTS.viewer.email, ACCOUNTS.admin.email]) {
    expect(await tablesContaining(email), email).toEqual([]);
  }

  await trashOpenPage(page);
});
