"use server";

import { revalidatePath } from "next/cache";
import { auditTranslator } from "@/i18n/audit";
import { recordAudit, userLabel } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { revokeGrant } from "@/lib/oauth/tokens";

// Ends one of the person's own app connections (lib/oauth/): its tokens stop
// working at once. Someone else's connection is "not found".
export async function disconnectApp(grantId: string): Promise<{ ok: boolean }> {
  const user = await requireUser("/account");
  const revoked = await revokeGrant(user.id, grantId);
  if (!revoked) return { ok: false };
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "mcp.disconnect",
    audit("audit.mcpDisconnect", { app: revoked.clientName || audit("audit.mcpUnnamedApp") }),
    { grantId },
  );
  revalidatePath("/account");
  return { ok: true };
}
