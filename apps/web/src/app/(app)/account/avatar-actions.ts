"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { MAX_AVATAR_BYTES, checkAvatar } from "@/lib/avatar-check";
import { sealAvatar } from "@/lib/avatar";
import { createRateLimiter } from "@/lib/rate-limit";

export type AvatarResult = { error?: string };

const avatarLimit = createRateLimiter(60_000, 10);

// The signed-in user's own picture (lib/avatar.ts): the browser has made it
// a small square (avatar-section.tsx); here only its type (from its bytes)
// and size are checked.
export async function saveAvatar(formData: FormData): Promise<AvatarResult> {
  const user = await requireUser("/account");
  const t = await getTranslations("account.avatar");
  if (avatarLimit(user.id) !== null) return { error: t("tooOften") };
  const file = formData.get("avatar");
  if (!(file instanceof File)) return { error: t("badType") };
  if (file.size > MAX_AVATAR_BYTES) return { error: t("tooLarge") };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkAvatar(bytes);
  if ("error" in checked) return { error: t(checked.error) };
  await prisma.user.update({
    where: { id: user.id },
    data: { avatarEnc: await sealAvatar(user.id, bytes), avatarType: checked.type, avatarUpdatedAt: new Date() },
  });
  revalidatePath("/", "layout");
  return {};
}

export async function removeAvatar(): Promise<AvatarResult> {
  const user = await requireUser("/account");
  await prisma.user.update({ where: { id: user.id }, data: { avatarEnc: null, avatarType: null, avatarUpdatedAt: null } });
  revalidatePath("/", "layout");
  return {};
}
