import { expect, test } from "@playwright/test";
import { loadDataKey, sealEmail } from "shared";
import { ACCOUNTS, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { startMailCapture } from "./mail-capture";

// The account screen's name and email address. Mail goes to a capture
// server; every test puts the account back as it was.

const NEW_EMAIL = "e2e-editor-new@example.com";

async function editorRow() {
  return withPrisma(async (prisma) =>
    prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true, name: true } }),
  );
}

test.use({ storageState: authFile("editor") });

test.describe("Name and email address", () => {
  let original: { id: string; name: string | null };

  test.beforeAll(async () => {
    original = await editorRow();
  });

  test.afterEach(async () => {
    await withPrisma(async (prisma) => {
      const key = await loadDataKey(prisma);
      await prisma.user.update({
        where: { id: original.id },
        data: { name: original.name, oidcIssuer: null, oidcSubject: null, ...sealEmail(key, ACCOUNTS.editor.email) },
      });
      await prisma.emailChangeRequest.deleteMany({ where: { userId: original.id } });
      await prisma.emailCode.deleteMany({ where: { userId: original.id } });
    });
  });

  test("the name is changed on the account screen", async ({ page }) => {
    await page.goto("account");
    await page.getByTestId("ProfileSection.nameInput").fill("E2E 新しい名前");
    await page.getByTestId("ProfileSection.nameSubmitButton").click();
    await expect(page.getByTestId("ProfileSection.nameStatus")).toHaveText("保存しました。");
    await page.reload();
    await expect(page.getByTestId("ProfileSection.nameInput")).toHaveValue("E2E 新しい名前");
  });

  test("a single sign-on account keeps its name unless the admin console allows changing it (and doesn't sync it)", async ({ page }) => {
    await withPrisma((prisma) =>
      prisma.user.update({ where: { id: original.id }, data: { oidcIssuer: "https://idp.example.com", oidcSubject: "e2e-sub" } }),
    );
    const previous = await withPrisma((prisma) =>
      prisma.oidcSettings.findUnique({ where: { id: 1 }, select: { allowNameChange: true, syncName: true } }),
    );
    const set = (allowNameChange: boolean, syncName: boolean) =>
      withPrisma((prisma) =>
        prisma.oidcSettings.upsert({
          where: { id: 1 },
          create: { id: 1, enabled: false, issuer: "", clientId: "", clientSecretEnc: new Uint8Array(), buttonLabel: "", allowNameChange, syncName },
          update: { allowNameChange, syncName },
        }),
      );
    try {
      await set(false, false);
      await page.goto("account");
      await expect(page.getByTestId("ProfileSection.nameLocked")).toBeVisible();
      await expect(page.getByTestId("ProfileSection.nameInput")).toHaveCount(0);

      // Allowed, but the name is set again at every sign-in: still locked.
      await set(true, true);
      await page.reload();
      await expect(page.getByTestId("ProfileSection.nameLocked")).toBeVisible();

      await set(true, false);
      await page.reload();
      await expect(page.getByTestId("ProfileSection.nameInput")).toBeVisible();
    } finally {
      await withPrisma(async (prisma) => {
        if (previous) await prisma.oidcSettings.update({ where: { id: 1 }, data: previous });
        else await prisma.oidcSettings.deleteMany({});
      });
    }
  });

  test("the email address changes after a code to the current one and a link to the new one", async ({ page }) => {
    const mail = await startMailCapture();
    try {
      await page.goto("account");
      await page.getByTestId("ProfileSection.changeEmailButton").click();
      await page.getByTestId("ProfileSection.newEmailInput").fill(NEW_EMAIL);
      // Confirmed with a code to the current address (no passkey here).
      const codeMail = mail.next(ACCOUNTS.editor.email);
      await page.getByTestId("ProfileSection.sendCodeButton").click();
      const code = /^(\d{6})$/m.exec((await codeMail).text)![1];
      await page.getByTestId("ProfileSection.codeInput").fill(code);
      const linkMail = mail.next(NEW_EMAIL);
      await page.getByTestId("ProfileSection.codeButton").click();
      await expect(page.getByTestId("ProfileSection.linkStatus")).toContainText(NEW_EMAIL);
      // Nothing changed yet.
      await page.reload();
      await expect(page.getByTestId("AccountPage.email")).toHaveText(ACCOUNTS.editor.email);

      // The link: opening it shows the change; the button makes it.
      const link = /https?:\/\/\S+\/email-change\/\S+/.exec((await linkMail).text)![0];
      const notice = mail.next(ACCOUNTS.editor.email);
      await page.goto(link);
      await expect(page.getByTestId("EmailChangePage.summary")).toContainText(NEW_EMAIL);
      await page.getByTestId("ConfirmEmailChangeForm.submitButton").click();
      await expect(page.getByTestId("ConfirmEmailChangeForm.done")).toContainText(NEW_EMAIL);
      // The old address is told.
      expect((await notice).text).toContain(NEW_EMAIL);
      await page.goto("account");
      await expect(page.getByTestId("AccountPage.email")).toHaveText(NEW_EMAIL);

      // The link works once.
      await page.goto(link);
      await expect(page.getByTestId("EmailChangePage.invalid")).toBeVisible();
    } finally {
      await mail.close();
    }
  });

  test("an address already in use isn't revealed on the screen: the mail says so", async ({ page }) => {
    const mail = await startMailCapture();
    try {
      await page.goto("account");
      await page.getByTestId("ProfileSection.changeEmailButton").click();
      await page.getByTestId("ProfileSection.newEmailInput").fill(ACCOUNTS.viewer.email);
      const codeMail = mail.next(ACCOUNTS.editor.email);
      await page.getByTestId("ProfileSection.sendCodeButton").click();
      await page.getByTestId("ProfileSection.codeInput").fill(/^(\d{6})$/m.exec((await codeMail).text)![1]);
      const inUse = mail.next(ACCOUNTS.viewer.email);
      await page.getByTestId("ProfileSection.codeButton").click();
      // Looks like any other request…
      await expect(page.getByTestId("ProfileSection.linkStatus")).toContainText(ACCOUNTS.viewer.email);
      // …but no link went out, and nothing changes.
      expect((await inUse).text).not.toMatch(/email-change\//);
      await page.reload();
      await expect(page.getByTestId("AccountPage.email")).toHaveText(ACCOUNTS.editor.email);
    } finally {
      await mail.close();
    }
  });
});
