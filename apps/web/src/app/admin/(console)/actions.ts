"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { endAdminSession, requireAdmin } from "@/lib/admin/auth";
import { formatCidr, isIpAllowed, parseCidr } from "@/lib/ip";
import { INVITATION_TTL_DAYS, createInvitation } from "@/lib/auth/invitations";
import { normalizeEmail } from "@/lib/auth/session";
import { getPublicUrl } from "@/lib/site-url";
import { InvalidPublicUrlError, normalizePublicUrl, type SiteRole } from "shared";
import { SITE_ROLE_LABELS, invitableRoles } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { manageableGroupIds } from "@/lib/group-access";
import { saveTheme as storeTheme } from "@/lib/theme";
import { getSignupSettings, isSignupRole, parseDomains } from "@/lib/auth/signup";
import { decrypt, loadDataKey } from "shared";
import { discoverWith, getOidcSettings, isOidcRole, sealClientSecret } from "@/lib/auth/oidc";
import { THEME_TOKENS, normalizeColor, type ThemeColors } from "@/lib/theme-tokens";
import {
  MailNotConfiguredError,
  getMailSettings,
  isMailConfigured,
  saveMailSettings,
  sendMail,
} from "@/lib/mail";
import { invitationMail } from "@/lib/mail-templates";
import { MAX_ALLOWED_EXTENSIONS, parseExtensions } from "@/lib/upload-types";
import { parseProxyUrl } from "@/lib/link-preview";
import { getLinkPreviewSettings, saveLinkPreviewSettings as storeLinkPreviewSettings } from "@/lib/link-preview-settings";
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
  const { session } = await requireAdmin(["SITE_ADMIN"]);
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
  const { session } = await requireAdmin(["SITE_ADMIN"]);
  await prisma.adminSession.deleteMany({ where: { tokenHash: { not: session.tokenHash } } });
  revalidatePath("/admin", "layout");
}

export type AllowlistState = { error?: string; saved?: boolean };

export async function saveIpAllowlist(
  _prev: AllowlistState,
  formData: FormData,
): Promise<AllowlistState> {
  const { ctx } = await requireAdmin(["SITE_ADMIN"]);
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

export async function issueInvitation(
  _prev: InvitationState,
  formData: FormData,
): Promise<InvitationState> {
  const { actorLabel, role: actorRole, actor } = await requireAdmin();
  const sendEmail = formData.get("sendEmail") === "on";
  // A content manager can only invite content managers or users.
  const siteRole = formData.get("siteRole");
  const allowedRoles = invitableRoles(actorRole);
  if (!allowedRoles.includes(siteRole as SiteRole)) {
    return { error: "招待するユーザーのロールを選んでください。" };
  }
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

  // Groups to join. Page access only ever comes from group grants.
  const requested = [...new Set(formData.getAll("groupIds").filter((v): v is string => typeof v === "string"))];
  const groups = await prisma.group.findMany({ where: { id: { in: requested } }, select: { id: true, name: true } });
  if (groups.length !== requested.length) return { error: "存在しないグループが選ばれています。" };
  // Content managers may only hand out groups within trees they manage.
  const allowedGroups = await manageableGroupIds(actor);
  if (allowedGroups !== "all" && groups.some((g) => !allowedGroups.has(g.id))) {
    return { error: "選べないグループが含まれています。" };
  }

  const token = await createInvitation({ email, siteRole: siteRole as SiteRole, groupIds: groups.map((g) => g.id) });
  await recordAudit(
    actor,
    "invitation.issue",
    `${email || "宛先指定なし"} を${SITE_ROLE_LABELS[siteRole as SiteRole]}として招待` +
      (groups.length ? `（グループ: ${groups.map((g) => g.name).join("、")}）` : ""),
    { email: email || null, siteRole: siteRole as SiteRole, groupIds: groups.map((g) => g.id) },
  );

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
        inviterName: actorLabel === "マスターパスワード" ? "KNOWLECTIVE の管理者" : actorLabel,
        siteRoleLabel: SITE_ROLE_LABELS[siteRole as SiteRole],
        groupNames: groups.map((g) => g.name),
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
  await requireAdmin(["SITE_ADMIN"]);
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
  await requireAdmin(["SITE_ADMIN"]);
  const to = formData.get("to");
  if (typeof to !== "string" || !EMAIL_RE.test(to.trim())) {
    return { error: "送信先メールアドレスの形式が正しくありません。" };
  }
  try {
    await sendMail({
      to: to.trim(),
      subject: "KNOWLECTIVE テストメール",
      text: "KNOWLECTIVE の管理画面から送信したテストメールです。\nこのメールが届いていれば、メール送信の設定は正しく動いています。",
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
  await requireAdmin(["SITE_ADMIN"]);
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
  await requireAdmin(["SITE_ADMIN"]);
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
  await requireAdmin(["SITE_ADMIN"]);
  await resetStorageSettings();
  revalidatePath("/admin", "layout");
}

export type StorageTestState = { result?: StorageTestResult };

export async function testStorageConnection(): Promise<StorageTestState> {
  await requireAdmin(["SITE_ADMIN"]);
  const config = await getStorageConfig();
  if (!config) return { result: { ok: false, step: "write", message: "ファイル保存が設定されていません。" } };
  return { result: await testStorage(config) };
}

export type UploadLimitState = { error?: string; saved?: boolean };

export async function saveUploadLimit(_prev: UploadLimitState, formData: FormData): Promise<UploadLimitState> {
  await requireAdmin(["SITE_ADMIN"]);
  const value = Number(formData.get("maxUploadSizeMb"));
  if (!Number.isInteger(value) || value < 1 || value > MAX_FILE_SIZE_MB_LIMIT) {
    return { error: `1〜${MAX_FILE_SIZE_MB_LIMIT} MB の整数で入力してください。` };
  }
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { maxUploadSizeMb: value } });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type UploadTypesState = { error?: string; saved?: boolean; extensions?: string[] };

// Which files may be attached, by extension. Empty = no restriction.
export async function saveUploadTypes(_prev: UploadTypesState, formData: FormData): Promise<UploadTypesState> {
  await requireAdmin(["SITE_ADMIN"]);
  const text = formData.get("extensions");
  const parsed = parseExtensions(typeof text === "string" ? text : "");
  if ("invalid" in parsed) {
    return { error: `拡張子として使えないものがあります：${parsed.invalid.slice(0, 10).join("、")}（英数字と - _ + で、16文字まで）` };
  }
  if (parsed.extensions.length > MAX_ALLOWED_EXTENSIONS) {
    return { error: `拡張子は ${MAX_ALLOWED_EXTENSIONS} 個までです。` };
  }
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { uploadAllowedExtensions: parsed.extensions } });
  revalidatePath("/admin", "layout");
  return { saved: true, extensions: parsed.extensions };
}

export type LinkPreviewSettingsState = { error?: string; saved?: boolean };

// Whether the server fetches the pages of pasted URLs, from where, and
// through which proxy.
export async function saveLinkPreviewSettings(
  _prev: LinkPreviewSettingsState,
  formData: FormData,
): Promise<LinkPreviewSettingsState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const before = await getLinkPreviewSettings();
  const enabled = formData.get("enabled") === "on";
  // The other fields are disabled (and so not sent) while previews are off:
  // keep what was saved.
  const allowPrivate = enabled ? formData.get("allowPrivate") === "on" : before.allowPrivate;

  let proxyUrl = before.proxyUrl;
  let proxyUsername = before.proxyUsername;
  let proxyPassword: string | undefined;
  if (enabled) {
    const rawProxy = formData.get("proxyUrl");
    const rawUser = formData.get("proxyUsername");
    const rawPassword = formData.get("proxyPassword");
    if (typeof rawProxy !== "string" || rawProxy.trim() === "") {
      proxyUrl = null;
      proxyUsername = null;
    } else {
      const parsed = parseProxyUrl(rawProxy);
      if (!parsed) return { error: "プロキシは http://ホスト名:ポート の形式で入力してください。" };
      if (parsed.username || parsed.password) {
        return { error: "プロキシのユーザー名とパスワードは、URL に書かずに下の欄に入力してください。" };
      }
      proxyUrl = parsed.origin;
      proxyUsername = typeof rawUser === "string" && rawUser.trim() !== "" ? rawUser.trim().slice(0, 200) : null;
      if (typeof rawPassword === "string" && rawPassword !== "") proxyPassword = rawPassword.slice(0, 500);
    }
  }

  await storeLinkPreviewSettings({ enabled, allowPrivate, proxyUrl, proxyUsername, proxyPassword });

  const describe = (s: { enabled: boolean; allowPrivate: boolean; proxyUrl: string | null }) =>
    s.enabled
      ? `使う（${s.allowPrivate ? "社内のサイトも対象" : "公開サイトのみ"}、${s.proxyUrl ? `プロキシ ${s.proxyUrl}` : "プロキシなし"}）`
      : "使わない";
  const from = describe(before);
  const to = describe({ enabled, allowPrivate, proxyUrl });
  if (from !== to || proxyPassword !== undefined || proxyUsername !== before.proxyUsername) {
    await recordAudit(actor, "link-preview.settings", `リンクのプレビューの設定を「${from}」から「${to}」に変更`, {
      from: { enabled: before.enabled, allowPrivate: before.allowPrivate, proxyUrl: before.proxyUrl },
      to: { enabled, allowPrivate, proxyUrl },
    });
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type ThemeState = { error?: string; saved?: boolean };

export async function saveTheme(_prev: ThemeState, formData: FormData): Promise<ThemeState> {
  await requireAdmin(["SITE_ADMIN"]);
  const theme = {} as ThemeColors;
  for (const t of THEME_TOKENS) {
    const value = normalizeColor(formData.get(t.key));
    if (!value) return { error: `「${t.label}」は #RRGGBB の形式で入力してください。` };
    theme[t.key] = value;
  }
  await storeTheme(theme);
  // The theme is injected by the root layout, so every screen needs it.
  revalidatePath("/", "layout");
  return { saved: true };
}

export type SignupSettingsState = { error?: string; saved?: boolean };

// Invitation-only vs. self-registration (/signup). Site admins only.
export async function saveSignupSettings(_prev: SignupSettingsState, formData: FormData): Promise<SignupSettingsState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const mode = formData.get("mode");
  if (mode !== "INVITE_ONLY" && mode !== "OPEN") return { error: "入力内容が不正です。" };
  const before = await getSignupSettings();
  // Shown for OPEN only; keep the saved role otherwise. Never SITE_ADMIN.
  const rawRole = formData.get("siteRole") ?? before.siteRole;
  if (!isSignupRole(rawRole)) return { error: "入力内容が不正です。" };
  const siteRole = rawRole;
  // Signup confirms the address by mail, so it can't work without it.
  if (mode === "OPEN" && !before.mailConfigured) {
    return { error: "先に「概要」でメール送信を設定してください。" };
  }
  const rawDomains = formData.get("domains");
  // The domain field is only shown for OPEN; keep the saved list otherwise.
  const domains = typeof rawDomains === "string" ? parseDomains(rawDomains) : before.allowedDomains;
  if (!domains) return { error: "ドメインの形式が正しくありません（例: example.co.jp）。50個まで指定できます。" };

  await prisma.instanceConfig.update({
    where: { id: 1 },
    data: { signupMode: mode, signupAllowedDomains: domains, signupSiteRole: siteRole },
  });
  const describe = (m: string, d: string[], r: SiteRole) =>
    m === "OPEN"
      ? `誰でも登録できる（${d.length > 0 ? `ドメイン: ${d.join("、")}` : "ドメインの制限なし"}、${SITE_ROLE_LABELS[r]}として登録）`
      : "招待のみ";
  const from = describe(before.mode, before.allowedDomains, before.siteRole);
  const to = describe(mode, domains, siteRole);
  if (from !== to) {
    await recordAudit(actor, "signup.settings", `アカウント登録の設定を「${from}」から「${to}」に変更`, {
      from: { mode: before.mode, domains: before.allowedDomains, siteRole: before.siteRole },
      to: { mode, domains, siteRole },
    });
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type OidcFormState = { error?: string; saved?: boolean; message?: string };

type OidcInput = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  // Null: keep the saved one.
  clientSecret: string | null;
  buttonLabel: string;
  // "" = default (name, then preferred_username).
  nameClaim: string;
  newUserRole: "USER" | "CONTENT_MANAGER";
  allowedDomains: string[];
  trustEmail: boolean;
  passwordLogin: "ALLOWED" | "SITE_ADMINS_ONLY";
};

function readOidcForm(formData: FormData): OidcInput | string {
  const text = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const issuer = text("issuer");
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return "Issuer URL を入力してください（https://〜）。";
  }
  // http only for a local IdP (development).
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    return "Issuer URL は https:// で始まる必要があります。";
  }
  const clientId = text("clientId");
  if (!clientId || clientId.length > 500) return "クライアント ID を入力してください。";
  const secret = formData.get("clientSecret");
  const buttonLabel = text("buttonLabel") || "シングルサインオン";
  if (buttonLabel.length > 40) return "ボタンの名前は40文字以内にしてください。";
  const nameClaim = text("nameClaim");
  // A claim name, or a dotted path to a nested one.
  if (nameClaim && !/^[A-Za-z0-9_:\-]+(\.[A-Za-z0-9_:\-]+)*$/.test(nameClaim)) {
    return "表示名に使う属性は、属性名（英数字・_・-・:、入れ子は . 区切り）で入力してください。";
  }
  if (nameClaim.length > 100) return "表示名に使う属性は100文字以内にしてください。";
  const role = formData.get("newUserRole");
  if (!isOidcRole(role)) return "入力内容が不正です。";
  const domains = parseDomains(text("allowedDomains"));
  if (!domains) return "ドメインの形式が正しくありません（例: example.co.jp）。50個まで指定できます。";
  const passwordLogin = formData.get("passwordLogin");
  if (passwordLogin !== "ALLOWED" && passwordLogin !== "SITE_ADMINS_ONLY") return "入力内容が不正です。";
  return {
    enabled: formData.get("enabled") === "on",
    issuer,
    clientId,
    clientSecret: typeof secret === "string" && secret !== "" ? secret : null,
    buttonLabel,
    nameClaim,
    newUserRole: role,
    allowedDomains: domains,
    trustEmail: formData.get("trustEmail") === "on",
    passwordLogin,
  };
}

// The secret to use for a check: the one just entered, or the saved one.
async function secretFor(input: OidcInput): Promise<string | null> {
  if (input.clientSecret !== null) return input.clientSecret;
  const row = await prisma.oidcSettings.findUnique({ where: { id: 1 }, select: { clientSecretEnc: true } });
  if (!row || row.clientSecretEnc.length === 0) return null;
  return decrypt(await loadDataKey(prisma), row.clientSecretEnc, "knowlective:oidc-client-secret").toString("utf8");
}

async function checkIssuer(input: OidcInput, secret: string): Promise<string | null> {
  try {
    const config = await discoverWith({ issuer: input.issuer, clientId: input.clientId, clientSecret: secret });
    return config.serverMetadata().issuer;
  } catch (err) {
    console.error("[oidc] discovery check failed", err);
    return null;
  }
}

// 接続テスト: fetches the IdP's discovery document with the entered values.
// It can't check the client secret itself (only a real sign-in does).
export async function testOidcSettings(_prev: OidcFormState, formData: FormData): Promise<OidcFormState> {
  await requireAdmin(["SITE_ADMIN"]);
  const input = readOidcForm(formData);
  if (typeof input === "string") return { error: input, message: input };
  const secret = (await secretFor(input)) ?? "";
  const issuer = await checkIssuer(input, secret);
  if (!issuer) {
    return {
      error: "接続できません",
      message: "Issuer に接続できませんでした。URL と、サーバーから IdP に接続できるかを確認してください。",
    };
  }
  return {
    message: `IdP の設定を読み込めました（Issuer: ${issuer}）。クライアントシークレットが正しいかは、実際のログインで確認されます。`,
  };
}

export async function saveOidcSettings(_prev: OidcFormState, formData: FormData): Promise<OidcFormState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  // Turning it off needs none of the other fields (they're hidden then); the
  // saved settings are kept for turning it back on.
  if (formData.get("enabled") !== "on") {
    const { count } = await prisma.oidcSettings.updateMany({ where: { id: 1, enabled: true }, data: { enabled: false } });
    if (count > 0) await recordAudit(actor, "oidc.settings", "シングルサインオンの設定を変更: 無効にした", { enabled: false });
    revalidatePath("/admin", "layout");
    return { saved: true };
  }
  const input = readOidcForm(formData);
  if (typeof input === "string") return { error: input };
  const secret = await secretFor(input);
  if (secret === null) return { error: "クライアントシークレットを入力してください。" };
  // Don't turn on a sign-in button that can't work.
  if (input.enabled && !(await checkIssuer(input, secret))) {
    return { error: "Issuer に接続できなかったため、有効にできません。「接続テスト」で確認してください。" };
  }

  const before = await getOidcSettings();
  const sealed = input.clientSecret !== null ? await sealClientSecret(input.clientSecret) : null;
  const data = {
    enabled: input.enabled,
    issuer: input.issuer,
    clientId: input.clientId,
    buttonLabel: input.buttonLabel,
    nameClaim: input.nameClaim || null,
    newUserRole: input.newUserRole,
    allowedDomains: input.allowedDomains,
    trustEmail: input.trustEmail,
    passwordLogin: input.passwordLogin,
    ...(sealed && { clientSecretEnc: sealed }),
  };
  await prisma.oidcSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data, clientSecretEnc: sealed ?? (await sealClientSecret(secret)) },
    update: data,
  });

  const changes: string[] = [];
  if (before.enabled !== input.enabled) changes.push(input.enabled ? "有効にした" : "無効にした");
  if (before.issuer !== input.issuer) changes.push(`Issuer を ${input.issuer} に`);
  if (before.clientId !== input.clientId) changes.push("クライアント ID を変更");
  if (input.clientSecret !== null) changes.push("クライアントシークレットを変更");
  if (before.nameClaim !== input.nameClaim) changes.push(`表示名に使う属性を${input.nameClaim || "既定（name）"}に`);
  if (before.newUserRole !== input.newUserRole) changes.push(`新規アカウントのロールを${SITE_ROLE_LABELS[input.newUserRole]}に`);
  if (before.allowedDomains.join() !== input.allowedDomains.join()) {
    changes.push(`ドメインを${input.allowedDomains.length > 0 ? input.allowedDomains.join("、") : "制限なし"}に`);
  }
  if (before.trustEmail !== input.trustEmail) {
    changes.push(input.trustEmail ? "メールアドレスを確認済みとして扱う" : "メールアドレスの確認を必須に");
  }
  if (before.passwordLogin !== input.passwordLogin) {
    changes.push(input.passwordLogin === "SITE_ADMINS_ONLY" ? "パスワードログインをサイト管理者だけに" : "パスワードログインを併用に");
  }
  if (changes.length > 0) {
    await recordAudit(actor, "oidc.settings", `シングルサインオンの設定を変更: ${changes.join("、")}`, {
      enabled: input.enabled,
      issuer: input.issuer,
      newUserRole: input.newUserRole,
      allowedDomains: input.allowedDomains,
      trustEmail: input.trustEmail,
      passwordLogin: input.passwordLogin,
    });
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}
