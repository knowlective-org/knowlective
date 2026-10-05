"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { endAdminSession, requireAdmin } from "@/lib/admin/auth";
import { formatCidr, isIpAllowed, parseCidr } from "@/lib/ip";
import { INVITATION_TTL_DAYS, createInvitation } from "@/lib/auth/invitations";
import { normalizeEmail } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/admin/format";
import { getPublicUrl } from "@/lib/site-url";
import { rootName, rootNameSelect } from "@/lib/knowledge-roots";
import { InvalidPublicUrlError, normalizePublicUrl } from "shared";
import {
  MailNotConfiguredError,
  getMailSettings,
  isMailConfigured,
  saveMailSettings,
  sendMail,
} from "@/lib/mail";
import { invitationMail } from "@/lib/mail-templates";
import {
  MAX_FILE_SIZE_MB_LIMIT,
  type StorageTestResult,
  getStorageConfig,
  getStorageSettingsView,
  normalizeKeyPrefix,
  resetStorageSettings,
  saveStorageSettings,
  testStorage,
} from "@/lib/storage";

export async function logout(): Promise<void> {
  await requireAdmin();
  await endAdminSession();
  redirect("/admin/login");
}

export async function revokeSession(formData: FormData): Promise<void> {
  const { session } = await requireAdmin();
  const target = formData.get("tokenHash");
  if (typeof target !== "string") return;
  if (target === session.tokenHash) {
    await endAdminSession();
    redirect("/admin/login");
  }
  await prisma.adminSession.deleteMany({ where: { tokenHash: target } });
  revalidatePath("/admin", "layout");
}

export async function revokeOtherSessions(): Promise<void> {
  const { session } = await requireAdmin();
  await prisma.adminSession.deleteMany({ where: { tokenHash: { not: session.tokenHash } } });
  revalidatePath("/admin", "layout");
}

export type AllowlistState = { error?: string; saved?: boolean };

export async function saveIpAllowlist(
  _prev: AllowlistState,
  formData: FormData,
): Promise<AllowlistState> {
  const { ctx } = await requireAdmin();
  const raw = formData.get("allowlist");
  if (typeof raw !== "string") return { error: "入力内容が不正です。" };

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  const invalid = lines.filter((l) => parseCidr(l) === null);
  if (invalid.length > 0) {
    return { error: `IP アドレスまたは CIDR として読めない行があります: ${invalid.join(", ")}` };
  }
  const allowlist = [...new Set(lines.map((l) => formatCidr(parseCidr(l)!)))];

  // Refuse to save a list that would lock out the admin making the change.
  if (!isIpAllowed(ctx.ip, allowlist)) {
    return {
      error: `現在の接続元（${ctx.ip}）が含まれていません。保存すると管理画面に入れなくなるため、保存しませんでした。`,
    };
  }

  await prisma.instanceConfig.update({ where: { id: 1 }, data: { adminIpAllowlist: allowlist } });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type InvitationState = {
  error?: string;
  link?: string;
  // Set when an invitation email was requested.
  mailSentTo?: string;
  mailError?: string;
};

const ROLES = ["ADMIN", "MEMBER", "GUEST"] as const;

export async function issueInvitation(
  _prev: InvitationState,
  formData: FormData,
): Promise<InvitationState> {
  const { actorLabel } = await requireAdmin();
  const sendEmail = formData.get("sendEmail") === "on";
  const target = formData.get("root");
  const role = formData.get("role");
  const newRootName = formData.get("newRootName");
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : "";
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return { error: "メールアドレスの形式が正しくありません。" };
  }
  if (sendEmail) {
    if (!email) return { error: "招待メールを送るには、メールアドレスを入力してください。" };
    if (!(await isMailConfigured())) {
      return { error: "メール送信が未設定です。「概要」の「メール送信」で設定してください。" };
    }
  }

  let token: string;
  let rootDisplayName: string;
  let roleLabel = ROLE_LABELS.OWNER;
  if (target === "__new__") {
    const name = typeof newRootName === "string" ? newRootName.trim() : "";
    if (!name) return { error: "新しいナレッジルートの名前を入力してください。" };
    token = await createInvitation({ kind: "new", rootName: name, email });
    rootDisplayName = name;
  } else {
    if (typeof target !== "string") return { error: "ナレッジルートを選んでください。" };
    const root = await prisma.knowledgeRoot.findUnique({
      where: { id: target },
      select: rootNameSelect,
    });
    if (!root) {
      return { error: "ナレッジルートを選んでください。" };
    }
    rootDisplayName = rootName(root);
    if (!ROLES.includes(role as (typeof ROLES)[number])) return { error: "権限を選んでください。" };
    roleLabel = ROLE_LABELS[role as string];
    token = await createInvitation({
      kind: "existing",
      rootId: target,
      role: role as (typeof ROLES)[number],
      email,
    });
  }

  revalidatePath("/admin", "layout");
  const link = `${await getPublicUrl()}/invite/${token}`;
  if (!sendEmail) return { link };

  // The invitation stays valid even if sending fails; the admin can still
  // hand over the link shown on screen.
  try {
    await sendMail({
      to: email,
      ...invitationMail({
        link,
        inviterName: actorLabel === "マスターパスワード" ? "yosuga の管理者" : actorLabel,
        rootName: rootDisplayName,
        isNewRoot: target === "__new__",
        roleLabel,
        ttlDays: INVITATION_TTL_DAYS,
      }),
    });
    return { link, mailSentTo: email };
  } catch (err) {
    return { link, mailError: err instanceof Error ? err.message : String(err) };
  }
}

export async function revokeInvitation(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string") return;
  await prisma.invitation.deleteMany({ where: { id, usedAt: null } });
  revalidatePath("/admin", "layout");
}

export type MailSettingsState = { error?: string; saved?: boolean };

const SECURITIES = ["NONE", "STARTTLS", "TLS"] as const;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+$/;

export async function saveMail(
  _prev: MailSettingsState,
  formData: FormData,
): Promise<MailSettingsState> {
  await requireAdmin();
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  const fromAddress = str("fromAddress");
  const fromName = str("fromName");
  const host = str("host");
  const port = Number(str("port"));
  const security = str("security");
  const authEnabled = formData.get("authEnabled") === "on";
  const username = str("username");
  // Not trimmed: spaces can be part of a password.
  const rawPassword = formData.get("password");
  const password = typeof rawPassword === "string" && rawPassword !== "" ? rawPassword : undefined;

  if (!EMAIL_RE.test(fromAddress)) return { error: "送信元メールアドレスの形式が正しくありません。" };
  if (!host || /\s/.test(host) || host.length > 253) return { error: "SMTP サーバーを正しく入力してください。" };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: "ポートは 1〜65535 の数字で入力してください。" };
  }
  if (!SECURITIES.includes(security as (typeof SECURITIES)[number])) {
    return { error: "暗号化方式を選んでください。" };
  }
  if (authEnabled) {
    if (security === "NONE") {
      return { error: "暗号化なしではパスワードが平文で送られるため、SMTP AUTH は使えません。STARTTLS か SSL/TLS を選んでください。" };
    }
    if (!username) return { error: "SMTP AUTH のユーザー名を入力してください。" };
    const current = await getMailSettings();
    if (password === undefined && !current?.hasPassword) {
      return { error: "SMTP AUTH のパスワードを入力してください。" };
    }
  }

  await saveMailSettings({
    fromAddress,
    fromName: fromName || null,
    host,
    port,
    security: security as (typeof SECURITIES)[number],
    authEnabled,
    username: username || null,
    password,
  });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type TestMailState = { error?: string; sentTo?: string };

export async function sendTestMail(
  _prev: TestMailState,
  formData: FormData,
): Promise<TestMailState> {
  await requireAdmin();
  const to = formData.get("to");
  if (typeof to !== "string" || !EMAIL_RE.test(to.trim())) {
    return { error: "送信先メールアドレスの形式が正しくありません。" };
  }
  try {
    await sendMail({
      to: to.trim(),
      subject: "yosuga テストメール",
      text: "yosuga の管理画面から送信したテストメールです。\nこのメールが届いていれば、メール送信の設定は正しく動いています。",
    });
  } catch (err) {
    if (err instanceof MailNotConfiguredError) return { error: "先にメール送信の設定を保存してください。" };
    // Shown to the admin only; SMTP errors are the most useful clue here.
    return { error: `送信に失敗しました: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { sentTo: to.trim() };
}

export type PublicUrlState = { error?: string; saved?: boolean };

export async function savePublicUrl(
  _prev: PublicUrlState,
  formData: FormData,
): Promise<PublicUrlState> {
  await requireAdmin();
  const input = formData.get("publicUrl");
  if (typeof input !== "string") return { error: "入力内容が不正です。" };
  let publicUrl: string;
  try {
    publicUrl = normalizePublicUrl(input);
  } catch (err) {
    if (err instanceof InvalidPublicUrlError) return { error: err.message };
    throw err;
  }
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicUrl } });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type StorageFormState = { error?: string; saved?: boolean; needsMigrationConfirm?: number };

function locationOf(s: { endpoint: string; bucket: string; keyPrefix: string }) {
  return `${s.endpoint.replace(/\/+$/, "")}|${s.bucket}|${s.keyPrefix}`;
}

export async function saveStorage(_prev: StorageFormState, formData: FormData): Promise<StorageFormState> {
  await requireAdmin();
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };
  const endpoint = str("endpoint");
  const bucket = str("bucket");
  const region = str("region");
  const accessKeyId = str("accessKeyId");
  const rawSecret = formData.get("secretAccessKey");
  const secretAccessKey = typeof rawSecret === "string" && rawSecret !== "" ? rawSecret : undefined;
  const forcePathStyle = formData.get("forcePathStyle") === "on";
  const keyPrefix = normalizeKeyPrefix(str("keyPrefix"));

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    return { error: "エンドポイント URL は http:// または https:// で始まる URL で入力してください。" };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(bucket)) return { error: "バケット名を正しく入力してください。" };
  if (region && !/^[A-Za-z0-9-]{1,64}$/.test(region)) return { error: "リージョンの形式が正しくありません。" };
  if (!accessKeyId) return { error: "アクセスキー ID を入力してください。" };

  const current = await getStorageSettingsView();
  if (current?.source !== "custom" && secretAccessKey === undefined) {
    return { error: "シークレットアクセスキーを入力してください。" };
  }

  // Moving storage is an infrastructure task: the app never copies objects.
  // Make the admin confirm existing files were migrated first.
  const fileCount = await prisma.fileObject.count();
  const moving = !current || locationOf(current) !== locationOf({ endpoint, bucket, keyPrefix });
  if (moving && fileCount > 0 && formData.get("confirmMigrated") !== "on") {
    return { needsMigrationConfirm: fileCount };
  }

  await saveStorageSettings({
    endpoint,
    region: region || null,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    keyPrefix,
  });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function resetStorage(): Promise<void> {
  await requireAdmin();
  await resetStorageSettings();
  revalidatePath("/admin", "layout");
}

export type StorageTestState = { result?: StorageTestResult };

export async function testStorageConnection(): Promise<StorageTestState> {
  await requireAdmin();
  const config = await getStorageConfig();
  if (!config) return { result: { ok: false, step: "write", message: "ファイル保存が設定されていません。" } };
  return { result: await testStorage(config) };
}

export type UploadLimitState = { error?: string; saved?: boolean };

export async function saveUploadLimit(_prev: UploadLimitState, formData: FormData): Promise<UploadLimitState> {
  await requireAdmin();
  const value = Number(formData.get("maxUploadSizeMb"));
  if (!Number.isInteger(value) || value < 1 || value > MAX_FILE_SIZE_MB_LIMIT) {
    return { error: `1〜${MAX_FILE_SIZE_MB_LIMIT} MB の整数で入力してください。` };
  }
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { maxUploadSizeMb: value } });
  revalidatePath("/admin", "layout");
  return { saved: true };
}
