import { prisma } from "@/lib/db";
import { recordAudit, userLabel } from "@/lib/audit";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { withEmail } from "@/lib/emails";

// The audit log entry for moving a page to the trash: from the page menu or
// the sidebar ("screen"), or through the API or MCP. `descendants`: the live
// pages under it that went with it. The title is hidden from those who
// couldn't open the page (lib/audit-pages.ts, admin's audit-view.ts).
export async function recordPageDelete(
  userId: string,
  page: { id: string; title: string; parentId: string },
  descendants: number,
  via: "screen" | "api" | "mcp",
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, emailEnc: true } });
  const label = user ? userLabel(await withEmail(user)) : "";
  const audit = await auditTranslator();
  const summary = (title: string) => audit("audit.pageDelete", { title, descendants, via });
  await recordAudit(
    { userId, label },
    "page.delete",
    summary(displayTitleWith(audit)(page.title)),
    { pageId: page.id, parentId: page.parentId, descendants, via },
    summary(audit("audit.hiddenPage")),
  );
}
