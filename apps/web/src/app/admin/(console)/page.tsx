import { getTranslations } from "next-intl/server";
import { isInsecurePublicUrl } from "shared";
import { siteDefaultLocale } from "@/i18n/locale";
import { BASE_PATH } from "@/lib/base-path";
import { prisma } from "@/lib/db";
import { requireAdminView } from "@/lib/admin/auth";
import { AdminReadOnly } from "./admin-read-only";
import { getMailSettings } from "@/lib/mail";
import { getRequestOrigin } from "@/lib/request";
import styles from "@/styles/ui.module.css";
import { MailSettingsForm, TestMailForm } from "./mail-settings-form";
import { PublicUrlForm } from "./public-url-form";
import { DefaultLocaleForm } from "./default-locale-form";

import { getTheme } from "@/lib/theme";
import { ThemeForm } from "./theme-form";
import { BrandForm } from "./brand-form";
import { MAX_BRAND_NAME_LENGTH, getBrand } from "@/lib/brand";
import { getLinkPreviewSettings } from "@/lib/link-preview-settings";
import { LinkPreviewSettingsForm } from "./link-preview-settings-form";
import { publicPageIds } from "@/lib/public-pages";
import { PublicPagesForm } from "./public-pages-form";
import { landingPageFor, landingPageOptions } from "@/lib/landing-page";
import { LandingPageForm } from "./landing-page-form";
import { PushNotificationsForm } from "./push-notifications-form";
import { getOutboundProxySettings } from "@/lib/outbound-proxy";
import { OutboundProxyForm } from "./outbound-proxy-form";
import { AuditorSettingsForm } from "./auditor-settings-form";
import { publicTrees } from "@/lib/sidebar-data";
import { getDisplayTitle } from "@/i18n/display-title";
import { PublicRootOrderForm } from "./public-root-order-form";

export default async function AdminOverviewPage() {
  const { actor, readOnly } = await requireAdminView(["SITE_ADMIN"]);
  const [mail, site, requestOrigin, siteAdminCount, theme, linkPreview, publicPages, landingOptions, guestLanding, locale, t, brand, outboundProxy] =
    await Promise.all([
      getMailSettings(),
      prisma.instanceConfig.findUniqueOrThrow({
        where: { id: 1 },
        select: {
          publicUrl: true,
          publicPagesAllowed: true,
          searchEnginesAllowed: true,
          landingPageId: true,
          pushNotificationsEnabled: true,
          auditorsSeePersonalRoots: true,
        },
      }),
      getRequestOrigin(),
      prisma.user.count({ where: { siteRole: "SITE_ADMIN", disabledAt: null } }),
      getTheme(),
      getLinkPreviewSettings(),
      publicPageIds(),
      landingPageOptions(actor.userId),
      landingPageFor(null),
      siteDefaultLocale(),
      getTranslations("admin.overview"),
      getBrand(),
      getOutboundProxySettings(prisma),
    ]);
  const code = (chunks: React.ReactNode) => <code>{chunks}</code>;
  // The roots with public pages, named as someone not logged in sees them:
  // by their public pages' titles (a root's own title only if it's public).
  const displayTitle = await getDisplayTitle();
  const publicRoots = site.publicPagesAllowed
    ? (await publicTrees()).map((tree) => {
        const titles = tree.entryIds.map((id) => displayTitle(tree.pages.find((p) => p.id === id)?.title ?? ""));
        return { rootId: tree.rootId, label: titles.length > 2 ? t("publicRootMore", { first: titles.slice(0, 2).join(" / "), more: titles.length - 2 }) : titles.join(" / ") };
      })
    : [];

  return (
    <AdminReadOnly readOnly={readOnly}>
      {siteAdminCount === 0 && (
        <p data-ui="AdminOverviewPage.noSiteAdminError" className={styles.error} style={{ marginBottom: 24 }}>
          {t("noSiteAdmin")}
        </p>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("site")}</h2>
        {site.publicUrl === null && (
          <p data-ui="AdminOverviewPage.publicUrlUnsetError" className={styles.error} style={{ marginBottom: 12 }}>
            {t("publicUrlUnset", { origin: requestOrigin })}
          </p>
        )}
        {site.publicUrl !== null && isInsecurePublicUrl(site.publicUrl) && (
          <p data-ui="AdminOverviewPage.insecurePublicUrlError" className={styles.error} style={{ marginBottom: 12 }}>
            {t("insecurePublicUrl")}
          </p>
        )}
        <PublicUrlForm current={site.publicUrl} suggested={requestOrigin} />
        <p className={styles.note} style={{ marginTop: 16 }} data-ui="AdminOverviewPage.basePath">
          {t("basePath")}
          {BASE_PATH ? <code>{BASE_PATH}</code> : t("basePathNone")}
          {site.publicUrl !== null && BASE_PATH && t.rich("basePathLinks", { url: site.publicUrl + BASE_PATH, code })}
          <br />
          {t.rich("basePathNote", { code })}
        </p>
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.languageSection">
        <h2 className={styles.sectionTitle}>{t("language")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("languageLead")}
        </p>
        <DefaultLocaleForm current={locale} />
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.brandSection">
        <h2 className={styles.sectionTitle}>{t("brand")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("brandLead")}
        </p>
        <BrandForm current={brand} maxNameLength={MAX_BRAND_NAME_LENGTH} />
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.themeSection">
        <h2 className={styles.sectionTitle}>{t("theme")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("themeLead")}
        </p>
        <ThemeForm current={theme} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("mail")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("mailLead")}
        </p>
        <MailSettingsForm current={mail} />
        <div style={{ marginTop: 24 }}>
          <TestMailForm disabled={mail === null} />
        </div>
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.linkPreviewSection">
        <h2 className={styles.sectionTitle}>{t("linkPreview")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("linkPreviewLead")}
        </p>
        <LinkPreviewSettingsForm current={linkPreview} />
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.pushNotificationsSection">
        <h2 className={styles.sectionTitle}>{t("pushNotifications")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("pushNotificationsLead")}
        </p>
        <PushNotificationsForm enabled={site.pushNotificationsEnabled} />
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.auditorsSection">
        <h2 className={styles.sectionTitle}>{t("auditors")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("auditorsLead")}
        </p>
        <AuditorSettingsForm personalRoots={site.auditorsSeePersonalRoots} />
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.outboundProxySection">
        <h2 className={styles.sectionTitle}>{t("outboundProxy")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("outboundProxyLead")}
        </p>
        <OutboundProxyForm current={outboundProxy} />
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.publicPagesSection">
        <h2 className={styles.sectionTitle}>{t("publicPages")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("publicPagesLead")}
        </p>
        <PublicPagesForm
          allowed={site.publicPagesAllowed}
          searchEnginesAllowed={site.searchEnginesAllowed}
          publicCount={publicPages.length}
        />
      </section>

      {site.publicPagesAllowed && (
        <section className={styles.section} data-ui="AdminOverviewPage.publicRootOrderSection">
          <h2 className={styles.sectionTitle}>{t("publicRootOrder")}</h2>
          <p className={styles.note} style={{ marginBottom: 16 }}>
            {t("publicRootOrderLead")}
          </p>
          {publicRoots.length >= 2 ? (
            // Remade when roots come or go (not when the order is saved: it'd lose its status).
            <PublicRootOrderForm key={publicRoots.map((r) => r.rootId).sort().join(" ")} roots={publicRoots} />
          ) : (
            <p className={styles.note} data-ui="AdminOverviewPage.publicRootOrderStatus">
              {t("publicRootOrderFew")}
            </p>
          )}
        </section>
      )}

      <section className={styles.section} data-ui="AdminOverviewPage.landingPageSection">
        <h2 className={styles.sectionTitle}>{t("landing")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("landingLead")}
        </p>
        <LandingPageForm
          landingPageId={site.landingPageId}
          options={landingOptions}
          guestsCanView={guestLanding !== null}
        />
      </section>
    </AdminReadOnly>
  );
}
