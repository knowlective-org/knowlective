import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { withPrisma } from "./db";
import { createPage, pasteText, trashOpenPage } from "./helpers";

// The outbound proxy set in /admin (lib/outbound-proxy.ts): the server's own
// requests go through it, except to the hosts on its bypass list. Shown with
// link previews, against a proxy run by the test that answers for a name no
// DNS knows (so it can only be reached through the proxy).

test("the server's requests to the outside go through the proxy set in /admin, except those it bypasses", async ({ page, browser }) => {
  const asked: string[] = [];
  const proxy = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    if (req.url?.startsWith("http://preview.e2e.invalid/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><head><title>プロキシ経由のページ</title></head><body></body></html>");
    } else {
      res.writeHead(502).end();
    }
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  const editorContext = await browser.newContext({ storageState: authFile("editor") });
  try {
    await openAdmin(page);
    const form = page.getByTestId("OutboundProxyForm");
    const status = form.getByTestId("OutboundProxyForm.status");
    // The rest is asked for once there's a proxy.
    await expect(form.getByTestId("OutboundProxyForm.bypassInput")).toHaveCount(0);
    // Credentials go in their own fields, not the URL.
    await form.getByTestId("OutboundProxyForm.urlInput").fill("http://user:pw@proxy.example.co.jp:8080");
    await form.getByTestId("OutboundProxyForm.submitButton").click();
    await expect(status).toContainText("下の欄に入力");
    await form.getByTestId("OutboundProxyForm.urlInput").fill(proxyUrl);
    await form.getByTestId("OutboundProxyForm.bypassInput").fill("mail.example.co.jp\nhttp://bad");
    await form.getByTestId("OutboundProxyForm.submitButton").click();
    await expect(status).toContainText("http://bad");
    await form.getByTestId("OutboundProxyForm.bypassInput").fill("mail.example.co.jp");
    await form.getByTestId("OutboundProxyForm.submitButton").click();
    await expect(status).toHaveText("保存しました。");
    await page.reload();
    await expect(form.getByTestId("OutboundProxyForm.urlInput")).toHaveValue(proxyUrl);
    await expect(form.getByTestId("OutboundProxyForm.bypassInput")).toHaveValue("mail.example.co.jp");

    // Through the proxy: a name only the proxy knows.
    const editor = await editorContext.newPage();
    await createPage(editor, "E2E プロキシ");
    await pasteText(editor, "http://preview.e2e.invalid/doc");
    await expect(editor.getByTestId("LinkPreviewBlock.link")).toContainText("プロキシ経由のページ");
    expect(asked).toContain("http://preview.e2e.invalid/doc");
    await trashOpenPage(editor);

    // On the bypass list: reached directly (and so not at all).
    await form.getByTestId("OutboundProxyForm.bypassInput").fill("*.e2e.invalid");
    await form.getByTestId("OutboundProxyForm.submitButton").click();
    await expect(status).toHaveText("保存しました。");
    const before = asked.length;
    await createPage(editor, "E2E プロキシを通さない");
    await pasteText(editor, "http://preview.e2e.invalid/other");
    const card = editor.getByTestId("LinkPreviewBlock.link");
    await expect(card).toBeVisible();
    await expect(editor.getByTestId("PageView.status")).toHaveCount(0);
    await editor.waitForTimeout(2000);
    expect(asked.length).toBe(before);
    await expect(card).not.toContainText("プロキシ経由のページ");
    await trashOpenPage(editor);

    // No proxy again.
    await form.getByTestId("OutboundProxyForm.urlInput").fill("");
    await form.getByTestId("OutboundProxyForm.submitButton").click();
    await expect(status).toHaveText("保存しました。");
  } finally {
    await editorContext.close();
    await withPrisma((prisma) =>
      prisma.instanceConfig.update({
        where: { id: 1 },
        data: { outboundProxyUrl: null, outboundProxyUsername: null, outboundProxyPasswordEnc: null, outboundProxyBypass: [] },
      }),
    );
    await new Promise((resolve) => proxy.close(resolve));
  }
});
