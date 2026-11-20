import { decrypt, encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { type AvatarType, avatarUrl, isAvatarType } from "@/lib/avatar-check";

// A person's picture (User.avatar*), set by them on the account screen
// ((app)/account/avatar-actions.ts; the check is lib/avatar-check.ts).
// Shown where their name is (chat, the sidebar, the people menus, the admin
// console's user list), their initial where there's none. Like names, only
// to people who are logged in: served by /api/users/<id>/avatar.

const aad = (userId: string) => `knowlective:avatar:${userId}`;

export async function sealAvatar(userId: string, bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(bytes), aad(userId)));
}

export async function readAvatar(userId: string): Promise<{ type: AvatarType; bytes: Buffer } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarEnc: true, avatarType: true } });
  if (!user?.avatarEnc || !isAvatarType(user.avatarType)) return null;
  return { type: user.avatarType, bytes: decrypt(await loadDataKey(prisma), user.avatarEnc, aad(userId)) };
}

// The pictures of these people (those who have one), by id.
export async function avatarUrls(userIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: ids }, avatarUpdatedAt: { not: null } },
    select: { id: true, avatarUpdatedAt: true },
  });
  return new Map(rows.map((r) => [r.id, avatarUrl(r.id, r.avatarUpdatedAt)!]));
}

export async function ownAvatarUrl(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUpdatedAt: true } });
  return avatarUrl(userId, user?.avatarUpdatedAt);
}
