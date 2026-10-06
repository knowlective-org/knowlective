"use server";

import { redirect } from "next/navigation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword } from "shared";
import { prisma } from "@/lib/db";
import {
  InvitationUnavailableError,
  consumeInvitation,
  findValidInvitation,
} from "@/lib/auth/invitations";
import { createUserSession, normalizeEmail, requireUser } from "@/lib/auth/session";
import { getRequestContext } from "@/lib/request";

export type InviteState = { error?: string };

const UNAVAILABLE = "この招待リンクは使用済みか、期限が切れています。管理者に新しいリンクを依頼してください。";

export async function register(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const token = formData.get("token");
  const rawEmail = formData.get("email");
  const name = formData.get("name");
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (
    typeof token !== "string" ||
    typeof rawEmail !== "string" ||
    typeof name !== "string" ||
    typeof password !== "string" ||
    typeof confirm !== "string"
  ) {
    return { error: "入力内容が不正です。" };
  }

  const invitation = await findValidInvitation(token);
  if (!invitation) return { error: UNAVAILABLE };

  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return { error: "メールアドレスの形式が正しくありません。" };
  if (invitation.email && invitation.email !== email) {
    return { error: "この招待は別のメールアドレス宛てです。" };
  }
  if (name.trim() === "") return { error: "表示名を入力してください。" };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。` };
  }
  if (password !== confirm) return { error: "確認用のパスワードが一致しません。" };

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return {
      error: "このメールアドレスはすでに登録されています。ログインしてから、もう一度このリンクを開いてください。",
    };
  }

  const passwordHash = await hashPassword(password);
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name: name.trim(), passwordHash, siteRole: invitation.siteRole },
      });
      await consumeInvitation(tx, invitation.id, user.id);
      return user.id;
    });
  } catch (err) {
    if (err instanceof InvitationUnavailableError) return { error: UNAVAILABLE };
    // Unique violation: the same email registered concurrently.
    if ((err as { code?: string }).code === "P2002") {
      return { error: "このメールアドレスはすでに登録されています。" };
    }
    throw err;
  }

  await createUserSession(await getRequestContext(), userId);
  redirect("/");
}

// For a user who already has an account and is logged in.
export async function accept(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const token = formData.get("token");
  if (typeof token !== "string") return { error: "入力内容が不正です。" };
  const user = await requireUser(`/invite/${encodeURIComponent(token)}`);

  const invitation = await findValidInvitation(token);
  if (!invitation) return { error: UNAVAILABLE };
  if (invitation.email && invitation.email !== user.email) {
    return { error: "この招待は別のメールアドレス宛てです。" };
  }

  try {
    await prisma.$transaction((tx) => consumeInvitation(tx, invitation.id, user.id));
  } catch (err) {
    if (err instanceof InvitationUnavailableError) return { error: UNAVAILABLE };
    throw err;
  }
  redirect("/");
}
