import { decrypt, encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { type AvatarLook, type AvatarType, avatarLook, isAvatarType } from "@/lib/avatar-check";

// A person's picture (User.avatar*), set by them on the account screen
// ((app)/account/avatar-actions.ts; the check is lib/avatar-check.ts).
// Shown where their name is (chat, the sidebar, the people menus, the admin
// console's user list); without one, a mosaic in their color with their
// initial (lib/avatar-mosaic.ts). Like names, only
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

export const AVATAR_SELECT = { id: true, avatarUpdatedAt: true, avatarColor: true, avatarSeed: true } as const;

// How these people's avatars look, by id.
export async function avatarLooks(userIds: Iterable<string>): Promise<Map<string, AvatarLook>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: AVATAR_SELECT });
  return new Map(rows.map((r) => [r.id, avatarLook(r)]));
}
