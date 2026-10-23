import { apiJson, withApiKey } from "@/lib/api/http";

// The key's owner and the key itself: for checking a key works.
export async function GET(request: Request) {
  return withApiKey(request, "READ", async ({ user, key }) =>
    apiJson({
      user: { id: user.id, name: user.name, email: user.email, siteRole: user.siteRole },
      key: { scope: key.scope, expiresAt: key.expiresAt?.toISOString() ?? null },
    }),
  );
}
