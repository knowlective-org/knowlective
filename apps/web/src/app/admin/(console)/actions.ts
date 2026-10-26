"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { groupName } from "@/i18n/group-name";
import { isLocale, LOCALE_NAMES } from "@/i18n/locales";
import { withBasePath } from "@/lib/base-path";
import { prisma } from "@/lib/db";
import { endAdminSession, requireAdmin } from "@/lib/admin/auth";
import { formatCidr, isIpAllowed, parseCidr } from "@/lib/ip";
import { networkSettingsChanged } from "@/lib/network-policy";
import { INVITATION_TTL_DAYS, createInvitation } from "@/lib/auth/invitations";
import { normalizeEmail } from "@/lib/auth/session";
import { getPublicUrl } from "@/lib/site-url";
import { InvalidPublicUrlError, normalizePublicUrl, type SiteRole } from "shared";
import { invitableRoles } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { reconnectDocuments } from "@/lib/collab-events";
import { landingPageOptions } from "@/lib/landing-page";
import { publicPageIds } from "@/lib/public-pages";
import { searchEngineSettingChanged } from "@/lib/search-engines";
import { manageableGroupIds } from "@/lib/group-access";
import { saveTheme as storeTheme } from "@/lib/theme";
import { MAX_BRAND_NAME_LENGTH, checkLogoSvg, getBrand, getBrandLogo, saveBrand } from "@/lib/brand";
import { getSignupSettings, isSignupRole, parseDomains } from "@/lib/auth/signup";
import { decrypt, loadDataKey } from "shared";
import {
  OIDC_STATE_COOKIE,
  OIDC_STATE_COOKIE_PATH,
  OIDC_STATE_MAX_AGE,
  discoverWith,
  getOidcSettings,
  isOidcRole,
  sealClientSecret,
} from "@/lib/auth/oidc";
import { beginTestLogin } from "@/lib/auth/oidc-test";
import { CLAIM_PATH, MAX_TEMPLATE_LENGTH, parseNameTemplate } from "@/lib/auth/oidc-profile";
import { THEME_TOKENS, normalizeColor, type ThemeColors } from "@/lib/theme-tokens";
import {
  MailNotConfiguredError,
  getMailSettings,
  isMailConfigured,
  saveMailSettings,
  sendMail,
} from "@/lib/mail";
import { invitationMail, testMail } from "@/lib/mail-templates";
import { getLocale } from "next-intl/server";
import { siteDefaultLocale } from "@/i18n/locale";
import { MAX_ALLOWED_EXTENSIONS, parseExtensions } from "@/lib/upload-types";
import { parseProxyUrl } from "@/lib/link-preview";
import { getLinkPreviewSettings, saveLinkPreviewSettings as storeLinkPreviewSettings } from "@/lib/link-preview-settings";
import {
  MAX_FILE_SIZE_MB_LIMIT,
  READ_BACK_MISMATCH,
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
  const t = await getTranslations();
  const raw = formData.get("allowlist");
  if (typeof raw !== "string") return { error: t("common.errors.invalidInput") };

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  const invalid = lines.filter((l) => parseCidr(l) === null);
  if (invalid.length > 0) {
    return { error: t("admin.ipAllowlist.errors.invalid", { lines: invalid.join(", ") }) };
  }
  const allowlist = [...new Set(lines.map((l) => formatCidr(parseCidr(l)!)))];

  // Refuse to save a list that would lock out the admin making the change.
  if (!isIpAllowed(ctx.ip, allowlist)) {
    return { error: t("admin.ipAllowlist.errors.lockout", { ip: ctx.ip }) };
  }

  await prisma.instanceConfig.update({ where: { id: 1 }, data: { adminIpAllowlist: allowlist } });
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type NetworkAccessState = { error?: string; saved?: boolean };

const NETWORK_FLAGS = ["access", "read", "write", "download", "upload"] as const;

// Who has full access to the site, by network, and what other networks may do
// (lib/network-policy.ts). The admin console isn't covered, so this can't lock
// the administrator out of it.
export async function saveNetworkAccess(_prev: NetworkAccessState, formData: FormData): Promise<NetworkAccessState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const t = await getTranslations();
  const raw = formData.get("fullAccess");
  if (typeof raw !== "string") return { error: t("common.errors.invalidInput") };
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  const invalid = lines.filter((l) => parseCidr(l) === null);
  if (invalid.length > 0) return { error: t("admin.network.errors.invalid", { lines: invalid.join(", ") }) };
  const fullAccess = [...new Set(lines.map((l) => formatCidr(parseCidr(l)!)))];
  const on = (name: (typeof NETWORK_FLAGS)[number]) => formData.get(name) === "on";
  // Each needs the one before it: nothing without access, no change without reading.
  const access = on("access");
  const read = access && on("read");
  const data = {
    networkFullAccess: fullAccess,
    networkOtherAccess: access,
    networkOtherRead: read,
    networkOtherWrite: read && on("write"),
    networkOtherDownload: access && on("download"),
    networkOtherUpload: read && on("upload"),
  };
  const before = await prisma.instanceConfig.findUniqueOrThrow({
    where: { id: 1 },
    select: {
      networkFullAccess: true,
      networkOtherAccess: true,
      networkOtherRead: true,
      networkOtherWrite: true,
      networkOtherDownload: true,
      networkOtherUpload: true,
    },
  });
  await prisma.instanceConfig.update({ where: { id: 1 }, data });
  networkSettingsChanged();
  if (JSON.stringify(before) !== JSON.stringify(data)) {
    const audit = await auditTranslator();
    const allowed = [
      data.networkOtherAccess && audit("audit.networkFlags.access"),
      data.networkOtherRead && audit("audit.networkFlags.read"),
      data.networkOtherWrite && audit("audit.networkFlags.write"),
      data.networkOtherDownload && audit("audit.networkFlags.download"),
      data.networkOtherUpload && audit("audit.networkFlags.upload"),
    ].filter(Boolean);
    await recordAudit(
      actor,
      "network.settings",
      audit("audit.network", {
        networks: fullAccess.length > 0 ? fullAccess.join(audit("common.listSeparator")) : "none",
        others: allowed.length > 0 ? allowed.join(audit("common.listSeparator")) : "none",
      }),
      data,
    );
  }
  revalidatePath("/", "layout");
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
  const t = await getTranslations();
  // A content manager can only invite content managers or users.
  const siteRole = formData.get("siteRole");
  const allowedRoles = invitableRoles(actorRole);
  if (!allowedRoles.includes(siteRole as SiteRole)) {
    return { error: t("admin.invitation.errors.role") };
  }
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : "";
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return { error: t("common.errors.emailFormat") };
  }
  if (sendEmail) {
    if (!email) return { error: t("admin.invitation.errors.emailRequired") };
    if (!(await isMailConfigured())) {
      return { error: t("admin.invitation.errors.mailNotConfigured") };
    }
  }

  // Groups to join. Page access only ever comes from group grants.
  const requested = [...new Set(formData.getAll("groupIds").filter((v): v is string => typeof v === "string"))];
  const groups = await prisma.group.findMany({ where: { id: { in: requested } }, select: { id: true, name: true, builtIn: true } });
  if (groups.length !== requested.length) return { error: t("admin.invitation.errors.unknownGroup") };
  // Content managers may only hand out groups within trees they manage.
  const allowedGroups = await manageableGroupIds(actor);
  if (allowedGroups !== "all" && groups.some((g) => !allowedGroups.has(g.id))) {
    return { error: t("admin.invitation.errors.groupNotAllowed") };
  }

  const token = await createInvitation({ email, siteRole: siteRole as SiteRole, groupIds: groups.map((g) => g.id) });
  const audit = await auditTranslator();
  await recordAudit(
    actor,
    "invitation.issue",
    audit("audit.invitationIssue", {
      email: email || audit("audit.invitationNoAddress"),
      role: audit(`roles.${siteRole as SiteRole}`),
      groups: groups.length
        ? audit("audit.invitationGroups", { groups: groups.map((g) => groupName(audit, g)).join(audit("common.listSeparator")) })
        : "",
    }),
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
      // Not known yet: the site default.
      ...invitationMail(await siteDefaultLocale(), {
        link,
        inviterName: actor.userId ? actorLabel : null,
        siteRole: siteRole as SiteRole,
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

  const t = await getTranslations("admin.mail.errors");
  if (!EMAIL_RE.test(fromAddress)) return { error: t("from") };
  if (!host || /\s/.test(host) || host.length > 253) return { error: t("host") };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: t("port") };
  }
  if (!SECURITIES.includes(security as (typeof SECURITIES)[number])) {
    return { error: t("security") };
  }
  if (authEnabled) {
    if (security === "NONE") {
      return { error: t("authNeedsTls") };
    }
    if (!username) return { error: t("username") };
    const current = await getMailSettings();
    if (password === undefined && !current?.hasPassword) {
      return { error: t("password") };
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
  const t = await getTranslations("admin.mail.errors");
  if (typeof to !== "string" || !EMAIL_RE.test(to.trim())) {
    return { error: t("to") };
  }
  try {
    await sendMail({
      to: to.trim(),
      ...testMail(await getLocale()),
    });
  } catch (err) {
    if (err instanceof MailNotConfiguredError) return { error: t("notConfigured") };
    // Shown to the admin only; SMTP errors are the most useful clue here.
    return { error: t("sendFailed", { message: err instanceof Error ? err.message : String(err) }) };
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
  const t = await getTranslations();
  if (typeof input !== "string") return { error: t("common.errors.invalidInput") };
  let publicUrl: string;
  try {
    publicUrl = normalizePublicUrl(input);
  } catch (err) {
    if (err instanceof InvalidPublicUrlError) return { error: t(`publicUrl.${err.reason}`) };
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
  const t = await getTranslations("admin.storage.errors");

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    return { error: t("endpoint") };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(bucket)) return { error: t("bucket") };
  if (region && !/^[A-Za-z0-9-]{1,64}$/.test(region)) return { error: t("region") };
  if (!accessKeyId) return { error: t("accessKey") };

  const current = await getStorageSettingsView();
  if (current?.source !== "custom" && secretAccessKey === undefined) {
    return { error: t("secretKey") };
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
  const t = await getTranslations("admin.storage.errors");
  if (!config) return { result: { ok: false, step: "write", message: t("notConfigured") } };
  const result = await testStorage(config);
  return { result: !result.ok && result.message === READ_BACK_MISMATCH ? { ...result, message: t("readBack") } : result };
}

export type UploadLimitState = { error?: string; saved?: boolean };

export async function saveUploadLimit(_prev: UploadLimitState, formData: FormData): Promise<UploadLimitState> {
  await requireAdmin(["SITE_ADMIN"]);
  const value = Number(formData.get("maxUploadSizeMb"));
  if (!Number.isInteger(value) || value < 1 || value > MAX_FILE_SIZE_MB_LIMIT) {
    return { error: (await getTranslations("admin.uploadLimit.errors"))("range", { max: MAX_FILE_SIZE_MB_LIMIT }) };
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
  const t = await getTranslations();
  if ("invalid" in parsed) {
    return { error: t("admin.uploadTypes.errors.invalid", { list: parsed.invalid.slice(0, 10).join(t("common.listSeparator")) }) };
  }
  if (parsed.extensions.length > MAX_ALLOWED_EXTENSIONS) {
    return { error: t("admin.uploadTypes.errors.tooMany", { max: MAX_ALLOWED_EXTENSIONS }) };
  }
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { uploadAllowedExtensions: parsed.extensions } });
  revalidatePath("/admin", "layout");
  return { saved: true, extensions: parsed.extensions };
}

export type DefaultLocaleState = { error?: string; saved?: boolean };

// The site's default language (i18n/locale.ts). Recorded in the audit log,
// itself written in the new language from then on.
export async function saveDefaultLocale(_prev: DefaultLocaleState, formData: FormData): Promise<DefaultLocaleState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const locale = formData.get("locale");
  if (!isLocale(locale)) return { error: (await getTranslations())("common.errors.invalidInput") };
  const before = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { defaultLocale: true } });
  if (before.defaultLocale !== locale) {
    await prisma.instanceConfig.update({ where: { id: 1 }, data: { defaultLocale: locale } });
    const from = isLocale(before.defaultLocale) ? LOCALE_NAMES[before.defaultLocale] : before.defaultLocale;
    await recordAudit(actor, "locale.settings", (await auditTranslator())("audit.defaultLocale", { from, to: LOCALE_NAMES[locale] }), {
      from: before.defaultLocale,
      to: locale,
    });
  }
  // Visitors without a language of their own see the site in it.
  revalidatePath("/", "layout");
  return { saved: true };
}

export type PublicPagesSettingState = { error?: string; saved?: boolean };

// Whether pages may be made public (viewable without logging in). Turning it
// off hides every public page at once — the grants stay, and count again if
// it's turned back on — and makes the editors open on them reconnect, so a
// visitor who isn't logged in stops receiving the page.
export async function savePublicPagesSetting(
  _prev: PublicPagesSettingState,
  formData: FormData,
): Promise<PublicPagesSettingState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const allowed = formData.get("allowed") === "on";
  // The form's checkbox is "keep out of search engines".
  const searchEnginesAllowed = formData.get("noindex") !== "on";
  const before = await prisma.instanceConfig.findUniqueOrThrow({
    where: { id: 1 },
    select: { publicPagesAllowed: true, searchEnginesAllowed: true },
  });
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicPagesAllowed: allowed, searchEnginesAllowed } });
  const audit = await auditTranslator();
  if (before.publicPagesAllowed !== allowed) {
    await recordAudit(
      actor,
      "public-pages.settings",
      audit("audit.publicPagesAllowed", { allowed: String(allowed) }),
      { allowed },
    );
    if (!allowed) reconnectDocuments(await publicPageIds());
  }
  if (before.searchEnginesAllowed !== searchEnginesAllowed) {
    await recordAudit(
      actor,
      "search-engines.settings",
      audit("audit.searchEngines", { allowed: String(searchEnginesAllowed) }),
      { allowed: searchEnginesAllowed },
    );
    searchEngineSettingChanged();
  }
  revalidatePath("/", "layout");
  return { saved: true };
}

export type LandingPageSettingState = { error?: string; saved?: boolean };

// The top page "/" opens for everyone with nowhere else to go (see
// lib/landing-page.ts): one of the pages the admin can open or the public
// ones, or none ("").
export async function saveLandingPage(_prev: LandingPageSettingState, formData: FormData): Promise<LandingPageSettingState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const raw = formData.get("landingPageId");
  const id = typeof raw === "string" && raw ? raw : null;
  const before = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { landingPageId: true } });
  // Unchanged: saved as it is, even if this admin can't see it.
  if (id === before.landingPageId) return { saved: true };
  const landing = id ? (await landingPageOptions(actor.userId)).find((o) => o.id === id) : null;
  if (landing === undefined) return { error: (await getTranslations("admin.landing.errors"))("notListed") };
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { landingPageId: id } });
  await recordAudit(
    actor,
    "landing-page.settings",
    (await auditTranslator())("audit.landingPage", { set: String(landing !== null), label: landing?.label ?? "" }),
    { pageId: id },
  );
  revalidatePath("/admin", "layout");
  return { saved: true };
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
      const t = await getTranslations("admin.linkPreview.errors");
      if (!parsed) return { error: t("proxy") };
      if (parsed.username || parsed.password) {
        return { error: t("proxyCredentials") };
      }
      proxyUrl = parsed.origin;
      proxyUsername = typeof rawUser === "string" && rawUser.trim() !== "" ? rawUser.trim().slice(0, 200) : null;
      if (typeof rawPassword === "string" && rawPassword !== "") proxyPassword = rawPassword.slice(0, 500);
    }
  }

  await storeLinkPreviewSettings({ enabled, allowPrivate, proxyUrl, proxyUsername, proxyPassword });

  const audit = await auditTranslator();
  const describe = (s: { enabled: boolean; allowPrivate: boolean; proxyUrl: string | null }) =>
    s.enabled
      ? audit("audit.linkPreviewOn", { allowPrivate: String(s.allowPrivate), proxy: s.proxyUrl ?? "none" })
      : audit("audit.linkPreviewOff");
  const from = describe(before);
  const to = describe({ enabled, allowPrivate, proxyUrl });
  if (from !== to || proxyPassword !== undefined || proxyUsername !== before.proxyUsername) {
    await recordAudit(actor, "link-preview.settings", audit("audit.linkPreview", { from, to }), {
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
  for (const token of THEME_TOKENS) {
    const value = normalizeColor(formData.get(token.key));
    if (!value) {
      const t = await getTranslations("admin.theme");
      return { error: t("errors.color", { label: t(`tokens.${token.key}`) }) };
    }
    theme[token.key] = value;
  }
  await storeTheme(theme);
  // The theme is injected by the root layout, so every screen needs it.
  revalidatePath("/", "layout");
  return { saved: true };
}

export type BrandState = { error?: string; saved?: boolean };

// The top left of the sidebars (lib/brand.ts): the site's name in text, or an
// SVG logo. A new logo replaces the stored one; without one, the stored one
// is kept (also when switching to text).
export async function saveBrandSettings(_prev: BrandState, formData: FormData): Promise<BrandState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const t = await getTranslations("admin.brand.errors");
  const mode = formData.get("mode");
  if (mode !== "TEXT" && mode !== "IMAGE") return { error: t("invalid") };
  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: t("nameRequired") };
  if (name.length > MAX_BRAND_NAME_LENGTH) return { error: t("nameTooLong", { max: MAX_BRAND_NAME_LENGTH }) };

  const file = formData.get("logo");
  let logoSvg: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (!/\.svg$/i.test(file.name) && file.type !== "image/svg+xml") return { error: t("notSvg") };
    const checked = checkLogoSvg(await file.text());
    if ("error" in checked) return { error: t(checked.error) };
    logoSvg = checked.svg;
  }
  if (mode === "IMAGE" && logoSvg === undefined && !(await getBrandLogo())) return { error: t("logoRequired") };

  const before = await getBrand();
  await saveBrand({ mode, name, logoSvg });
  if (before.mode !== mode || before.name !== name || logoSvg !== undefined) {
    const audit = await auditTranslator();
    await recordAudit(
      actor,
      "brand.settings",
      audit("audit.brand", { mode, name, logo: String(logoSvg !== undefined) }),
      { mode, name, logoChanged: logoSvg !== undefined },
    );
  }
  // Every screen's sidebar shows it.
  revalidatePath("/", "layout");
  return { saved: true };
}

export type SignupSettingsState = { error?: string; saved?: boolean };

// Invitation-only vs. self-registration (/signup). Site admins only.
export async function saveSignupSettings(_prev: SignupSettingsState, formData: FormData): Promise<SignupSettingsState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const mode = formData.get("mode");
  const t = await getTranslations();
  if (mode !== "INVITE_ONLY" && mode !== "OPEN") return { error: t("common.errors.invalidInput") };
  const before = await getSignupSettings();
  // Shown for OPEN only; keep the saved role otherwise. Never SITE_ADMIN.
  const rawRole = formData.get("siteRole") ?? before.siteRole;
  if (!isSignupRole(rawRole)) return { error: t("common.errors.invalidInput") };
  const siteRole = rawRole;
  // Signup confirms the address by mail, so it can't work without it.
  if (mode === "OPEN" && !before.mailConfigured) {
    return { error: t("admin.signup.errors.needsMail") };
  }
  const rawDomains = formData.get("domains");
  // The domain field is only shown for OPEN; keep the saved list otherwise.
  const domains = typeof rawDomains === "string" ? parseDomains(rawDomains) : before.allowedDomains;
  if (!domains) return { error: t("admin.signup.errors.domains") };

  await prisma.instanceConfig.update({
    where: { id: 1 },
    data: { signupMode: mode, signupAllowedDomains: domains, signupSiteRole: siteRole },
  });
  const audit = await auditTranslator();
  const describe = (m: string, d: string[], r: SiteRole) =>
    m === "OPEN"
      ? audit("audit.signupOpen", {
          domains: d.length > 0 ? d.join(audit("common.listSeparator")) : "none",
          role: audit(`roles.${r}`),
        })
      : audit("audit.signupInviteOnly");
  const from = describe(before.mode, before.allowedDomains, before.siteRole);
  const to = describe(mode, domains, siteRole);
  if (from !== to) {
    await recordAudit(actor, "signup.settings", audit("audit.signup", { from, to }), {
      from: { mode: before.mode, domains: before.allowedDomains, siteRole: before.siteRole },
      to: { mode, domains, siteRole },
    });
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export type ApiSettingState = { error?: string; saved?: boolean };

// The public API (lib/api/): on or off, and the site roles that may issue
// themselves keys. Both take effect on the next request (keys are checked
// against them every time).
export async function saveApiSettings(_prev: ApiSettingState, formData: FormData): Promise<ApiSettingState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const enabled = formData.get("enabled") === "on";
  const roles = SITE_ROLE_ORDER.filter((r) => formData.getAll("roles").includes(r));
  const before = await prisma.instanceConfig.findUniqueOrThrow({
    where: { id: 1 },
    select: { apiEnabled: true, apiKeyRoles: true },
  });
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { apiEnabled: enabled, apiKeyRoles: roles } });
  const rolesBefore = SITE_ROLE_ORDER.filter((r) => before.apiKeyRoles.includes(r));
  if (before.apiEnabled !== enabled || rolesBefore.join() !== roles.join()) {
    const audit = await auditTranslator();
    const roleNames = roles.map((r) => audit(`roles.${r}`)).join(audit("common.listSeparator")) || "-";
    await recordAudit(actor, "api.settings", audit("audit.apiSettings", { enabled: String(enabled), roles: roleNames }), {
      enabled,
      roles,
    });
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

// Most to least privileged, for showing and storing roles in a fixed order.
const SITE_ROLE_ORDER = ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] as const satisfies readonly SiteRole[];

export type PasskeySettingState = { error?: string; saved?: boolean };

// Passkeys required for everyone signing in with a password (lib/auth/passkeys.ts).
// Takes effect on everyone's next request: those without a passkey are sent
// to register one; those with one can't sign in with the password any more.
export async function savePasskeySetting(_prev: PasskeySettingState, formData: FormData): Promise<PasskeySettingState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const required = formData.get("required") === "on";
  const before = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { passkeyRequired: true } });
  await prisma.instanceConfig.update({ where: { id: 1 }, data: { passkeyRequired: required } });
  if (before.passkeyRequired !== required) {
    const audit = await auditTranslator();
    await recordAudit(actor, "passkey.settings", audit("audit.passkeyRequired", { required: String(required) }), {
      required,
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
  // A claim or a template of claims; "" = default (name, then preferred_username).
  nameClaim: string;
  syncName: boolean;
  // "" = no group sync.
  groupsClaim: string;
  newUserRole: "USER" | "CONTENT_MANAGER";
  allowedDomains: string[];
  trustEmail: boolean;
  allowNameChange: boolean;
  allowEmailChangeUnconfirmed: boolean;
  passwordLogin: "ALLOWED" | "SITE_ADMINS_ONLY";
};

// What's wrong with the form: admin.oidc.errors.<key>, or the common
// invalid-input message.
type OidcFormError =
  | "issuerRequired"
  | "issuerHttps"
  | "clientId"
  | "buttonLabel"
  | "nameClaim"
  | "nameClaimLength"
  | "groupsClaim"
  | "domains"
  | "invalid";

async function oidcErrorText(error: OidcFormError): Promise<string> {
  const t = await getTranslations();
  // Raw: some show a template with {braces} as is.
  return error === "invalid" ? t("common.errors.invalidInput") : t.raw(`admin.oidc.errors.${error}`);
}

function readOidcForm(formData: FormData): OidcInput | OidcFormError {
  const text = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const issuer = text("issuer");
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return "issuerRequired";
  }
  // http only for a local IdP (development).
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    return "issuerHttps";
  }
  const clientId = text("clientId");
  if (!clientId || clientId.length > 500) return "clientId";
  const secret = formData.get("clientSecret");
  // Empty: the login screen names it in the viewer's language.
  const buttonLabel = text("buttonLabel");
  if (buttonLabel.length > 40) return "buttonLabel";
  const nameClaim = text("nameClaim");
  if (nameClaim.length > MAX_TEMPLATE_LENGTH) return "nameClaimLength";
  // A claim name (a dotted path to a nested one), or a template of them.
  if (!parseNameTemplate(nameClaim)) return "nameClaim";
  const groupsClaim = text("groupsClaim");
  if (groupsClaim && (!CLAIM_PATH.test(groupsClaim) || groupsClaim.length > 100)) return "groupsClaim";
  const role = formData.get("newUserRole");
  if (!isOidcRole(role)) return "invalid";
  const domains = parseDomains(text("allowedDomains"));
  if (!domains) return "domains";
  const passwordLogin = formData.get("passwordLogin");
  if (passwordLogin !== "ALLOWED" && passwordLogin !== "SITE_ADMINS_ONLY") return "invalid";
  return {
    enabled: formData.get("enabled") === "on",
    issuer,
    clientId,
    clientSecret: typeof secret === "string" && secret !== "" ? secret : null,
    buttonLabel,
    nameClaim,
    syncName: formData.get("syncName") === "on",
    groupsClaim,
    newUserRole: role,
    allowedDomains: domains,
    trustEmail: formData.get("trustEmail") === "on",
    allowNameChange: formData.get("allowNameChange") === "on",
    allowEmailChangeUnconfirmed: formData.get("allowEmailChangeUnconfirmed") === "on",
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

// Connection test: fetches the IdP's discovery document with the entered values.
// It can't check the client secret itself (only a real sign-in does).
export async function testOidcSettings(_prev: OidcFormState, formData: FormData): Promise<OidcFormState> {
  await requireAdmin(["SITE_ADMIN"]);
  const input = readOidcForm(formData);
  if (typeof input === "string") {
    const text = await oidcErrorText(input);
    return { error: text, message: text };
  }
  const secret = (await secretFor(input)) ?? "";
  const issuer = await checkIssuer(input, secret);
  const t = await getTranslations("admin.oidc.errors");
  if (!issuer) return { error: t("unreachableTitle"), message: t("unreachable") };
  return { message: t("reachable", { issuer }) };
}

const MAX_LOGIN_HINT_LENGTH = 200;

// Test login (lib/auth/oidc-test.ts): starts a sign-in at the IdP with the
// entered settings and the user name to test. Returns the URL for the tab
// the form opened; the callback sends that tab to the result.
export async function startOidcTestLogin(formData: FormData): Promise<{ url?: string; error?: string }> {
  const { ctx, session } = await requireAdmin(["SITE_ADMIN"]);
  const input = readOidcForm(formData);
  if (typeof input === "string") return { error: await oidcErrorText(input) };
  const t = await getTranslations("admin.oidc.errors");
  const secret = await secretFor(input);
  if (secret === null) return { error: t("secret") };
  const hint = formData.get("testUser");
  const loginHint = typeof hint === "string" ? hint.trim() : "";
  if (loginHint.length > MAX_LOGIN_HINT_LENGTH) return { error: (await getTranslations())("common.errors.invalidInput") };

  let started: Awaited<ReturnType<typeof beginTestLogin>>;
  try {
    started = await beginTestLogin({
      issuer: input.issuer,
      clientId: input.clientId,
      clientSecret: secret,
      nameClaim: input.nameClaim,
      groupsClaim: input.groupsClaim,
      loginHint,
      adminUserId: session.userId,
    });
  } catch (err) {
    console.error("[oidc] test: discovery failed", err);
    return { error: t("unreachable") };
  }
  (await cookies()).set(OIDC_STATE_COOKIE, started.cookie, {
    path: withBasePath(OIDC_STATE_COOKIE_PATH),
    maxAge: OIDC_STATE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.secure,
  });
  return { url: started.url.href };
}

export async function saveOidcSettings(_prev: OidcFormState, formData: FormData): Promise<OidcFormState> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  // Turning it off needs none of the other fields (they're hidden then); the
  // saved settings are kept for turning it back on.
  if (formData.get("enabled") !== "on") {
    const { count } = await prisma.oidcSettings.updateMany({ where: { id: 1, enabled: true }, data: { enabled: false } });
    if (count > 0) {
      const audit = await auditTranslator();
      await recordAudit(actor, "oidc.settings", audit("audit.oidc", { changes: audit("audit.oidcEnabled", { enabled: "false" }) }), {
        enabled: false,
      });
    }
    revalidatePath("/admin", "layout");
    return { saved: true };
  }
  const input = readOidcForm(formData);
  if (typeof input === "string") return { error: await oidcErrorText(input) };
  const secret = await secretFor(input);
  const t = await getTranslations("admin.oidc.errors");
  if (secret === null) return { error: t("secret") };
  // Don't turn on a sign-in button that can't work.
  if (input.enabled && !(await checkIssuer(input, secret))) {
    return { error: t("cannotEnable") };
  }

  const before = await getOidcSettings();
  const sealed = input.clientSecret !== null ? await sealClientSecret(input.clientSecret) : null;
  const data = {
    enabled: input.enabled,
    issuer: input.issuer,
    clientId: input.clientId,
    buttonLabel: input.buttonLabel,
    nameClaim: input.nameClaim || null,
    syncName: input.syncName,
    groupsClaim: input.groupsClaim || null,
    newUserRole: input.newUserRole,
    allowedDomains: input.allowedDomains,
    trustEmail: input.trustEmail,
    allowNameChange: input.allowNameChange,
    allowEmailChangeUnconfirmed: input.allowEmailChangeUnconfirmed,
    passwordLogin: input.passwordLogin,
    ...(sealed && { clientSecretEnc: sealed }),
  };
  await prisma.oidcSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data, clientSecretEnc: sealed ?? (await sealClientSecret(secret)) },
    update: data,
  });

  const audit = await auditTranslator();
  const separator = audit("common.listSeparator");
  const changes: string[] = [];
  if (before.enabled !== input.enabled) changes.push(audit("audit.oidcEnabled", { enabled: String(input.enabled) }));
  if (before.issuer !== input.issuer) changes.push(audit("audit.oidcIssuer", { issuer: input.issuer }));
  if (before.clientId !== input.clientId) changes.push(audit("audit.oidcClientId"));
  if (input.clientSecret !== null) changes.push(audit("audit.oidcSecret"));
  if (before.nameClaim !== input.nameClaim) {
    changes.push(audit("audit.oidcNameClaim", { claim: input.nameClaim || audit("audit.oidcNameClaimDefault") }));
  }
  if (before.syncName !== input.syncName) changes.push(audit("audit.oidcSyncName", { sync: String(input.syncName) }));
  if (before.groupsClaim !== input.groupsClaim) {
    changes.push(audit("audit.oidcGroupsClaim", { claim: input.groupsClaim || "none" }));
  }
  if (before.newUserRole !== input.newUserRole) changes.push(audit("audit.oidcRole", { role: audit(`roles.${input.newUserRole}`) }));
  if (before.allowedDomains.join() !== input.allowedDomains.join()) {
    changes.push(
      audit("audit.oidcDomains", {
        domains: input.allowedDomains.length > 0 ? input.allowedDomains.join(separator) : audit("audit.oidcNoDomains"),
      }),
    );
  }
  if (before.trustEmail !== input.trustEmail) changes.push(audit("audit.oidcTrustEmail", { trust: String(input.trustEmail) }));
  if (before.allowNameChange !== input.allowNameChange) {
    changes.push(audit("audit.oidcNameChange", { allowed: String(input.allowNameChange) }));
  }
  if (before.allowEmailChangeUnconfirmed !== input.allowEmailChangeUnconfirmed) {
    changes.push(audit("audit.oidcEmailChange", { allowed: String(input.allowEmailChangeUnconfirmed) }));
  }
  if (before.passwordLogin !== input.passwordLogin) {
    changes.push(audit("audit.oidcPasswordLogin", { siteAdminsOnly: String(input.passwordLogin === "SITE_ADMINS_ONLY") }));
  }
  if (changes.length > 0) {
    await recordAudit(actor, "oidc.settings", audit("audit.oidc", { changes: changes.join(separator) }), {
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
