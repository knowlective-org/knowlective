import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { getDisplayTitle } from "@/i18n/display-title";
import { groupName } from "@/i18n/group-name";
import { ACCESS_RANK, MAX_PAGE_DEPTH, PUBLIC_GROUP, atLeast, getInheritedGroupAccess, type PageAccess } from "shared";
import { getVisibleTree } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { removeGrant, setGrant } from "./actions";
import { PublishForm, UnpublishForm } from "./public-forms";
import { publicPagesAllowed } from "@/lib/public-pages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("share.title") }) };
}

// ?error=<code> from the actions, and its message key.
const ERRORS = {
  "last-manager": "lastManager",
  invalid: "invalid",
  "public-not-allowed": "publicNotAllowed",
  raise: "raise",
  "inherited-manage": "inheritedManage",
} as const;

const GRANTABLE: PageAccess[] = ["VIEW", "EDIT", "MANAGE"];
// What an inherited level can be narrowed to (strongest first): itself, and
// everything weaker down to "no access".
const narrowerOrEqual = (inherited: PageAccess): PageAccess[] =>
  (["EDIT", "VIEW", "NONE"] as PageAccess[]).filter((a) => ACCESS_RANK[a] <= ACCESS_RANK[inherited]);

function AccessSelect({ defaultValue, options = GRANTABLE }: { defaultValue?: string; options?: PageAccess[] }) {
  const t = useTranslations("access");
  return (
    <select name="access" defaultValue={defaultValue ?? options[0]} className={styles.field} style={{ width: "auto", marginTop: 0 }} data-ui="AccessSelect">
      {options.map((a) => (
        <option key={a} value={a}>
          {t(a)}
        </option>
      ))}
    </select>
  );
}

export default async function SharePage({ params, searchParams }: PageProps<"/pages/[pageId]/share">) {
  const { pageId } = await params;
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}/share`);
  const page = await findAccessiblePage(user.id, pageId);
  if (!page) notFound();
  if (!atLeast(page.access, "MANAGE")) redirect(`/pages/${pageId}`);
  const [t, ta, displayTitle] = await Promise.all([getTranslations(), getTranslations("access"), getDisplayTitle()]);
  const errorCode = String((await searchParams).error ?? "");
  const error = errorCode in ERRORS ? t(`share.errors.${ERRORS[errorCode as keyof typeof ERRORS]}`) : null;

  // Ancestors, nearest first, for showing inherited grants.
  const ancestors: { id: string; title: string }[] = [];
  let cursor = (await prisma.page.findUnique({ where: { id: pageId }, select: { parentId: true } }))?.parentId ?? null;
  for (let i = 0; cursor && i < MAX_PAGE_DEPTH; i++) {
    const p = await prisma.page.findUnique({ where: { id: cursor }, select: { id: true, title: true, parentId: true } });
    if (!p) break;
    ancestors.push({ id: p.id, title: p.title });
    cursor = p.parentId;
  }
  const [allOwn, allInherited, groups, tree, sidebar, publicAllowed, inheritedAccess] = await Promise.all([
    prisma.pageGrant.findMany({
      where: { pageId },
      orderBy: { createdAt: "asc" },
      include: { group: { select: { id: true, name: true, builtIn: true, _count: { select: { members: true } } } } },
    }),
    prisma.pageGrant.findMany({
      where: { pageId: { in: ancestors.map((a) => a.id) } },
      include: { group: { select: { id: true, name: true, builtIn: true } } },
    }),
    prisma.group.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, builtIn: true } }),
    getVisibleTree(prisma, user.id, page.root.id),
    loadSidebar(user),
    publicPagesAllowed(),
    // Each group's grant nearest the parent: what this page inherits.
    getInheritedGroupAccess(prisma, pageId),
  ]);
  // The public group has a section of its own (publishing to the internet).
  const isPublic = (g: { builtIn: string | null }) => g.builtIn === PUBLIC_GROUP;
  const ownGrants = allOwn.filter((g) => !isPublic(g.group));
  const ownPublic = allOwn.some((g) => isPublic(g.group));
  // The nearest page above made public, if any.
  const publicAbove = ancestors.find((a) => allInherited.some((g) => g.pageId === a.id && isPublic(g.group))) ?? null;
  // Don't reveal titles of ancestors the manager itself can't see.
  const visible = new Set(tree?.pages.map((p) => p.id) ?? []);
  const ancestorTitle = (id: string) => {
    const a = ancestors.find((x) => x.id === id);
    return a && visible.has(a.id) ? t("share.quoted", { title: displayTitle(a.title) }) : t("share.hiddenAncestor");
  };
  const groupById = new Map(groups.map((g) => [g.id, g]));
  // A grant on this page that narrows what the group inherits (or keeps it):
  // shown, and changed, with the inherited ones. Other grants on this page
  // (groups that inherit nothing, or older grants above the inherited level)
  // are listed as this page's own.
  const narrows = (g: { groupId: string; access: PageAccess }) => {
    const inherited = inheritedAccess.get(g.groupId);
    return !!inherited && inherited.access !== "MANAGE" && ACCESS_RANK[g.access] <= ACCESS_RANK[inherited.access];
  };
  const own = ownGrants.filter((g) => !narrows(g));
  const overrideOf = new Map(ownGrants.filter(narrows).map((g) => [g.groupId, g.access]));
  const ownGroupIds = new Set(own.map((g) => g.groupId));
  const inheritedRows = [...inheritedAccess]
    .map(([groupId, grant]) => ({ groupId, ...grant, group: groupById.get(groupId) }))
    .filter((r) => r.group && !isPublic(r.group) && !ownGroupIds.has(r.groupId));
  // New grants: groups this page neither has nor inherits (those can only be narrowed).
  const addable = groups.filter((g) => !ownGroupIds.has(g.id) && !overrideOf.has(g.id) && !inheritedAccess.has(g.id) && !isPublic(g));

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={pageId} />}>
      <div className={styles.pane} data-ui="SharePage">
        <p className={styles.note} style={{ marginBottom: 16 }}>
          <Link href={`/pages/${pageId}`} style={{ textDecoration: "underline" }} data-ui="SharePage.backLink">
            {t("share.back")}
          </Link>
        </p>
        <h1 className={styles.title}>{t("share.heading", { title: displayTitle(page.title) })}</h1>
        <p className={styles.lead}>
          {t("share.lead")}
          {page.isRootPage && t("share.rootNote")}
        </p>
        {error && (
          <p className={styles.error} style={{ marginBottom: 16 }} data-ui="SharePage.error">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("share.direct")}</h2>
          {own.length === 0 ? (
            <p className={styles.note}>{t("share.noDirect")}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("share.group")}</th>
                    <th>{t("share.members")}</th>
                    <th>{t("share.access")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {own.map((g) => (
                    <tr key={g.id} data-ui="SharePage.grantRow" data-id={g.groupId}>
                      <td>{groupName(t, g.group)}</td>
                      <td>{g.group.builtIn ? t("share.everyoneAuto") : g.group._count.members}</td>
                      <td>
                        <form action={setGrant} style={{ display: "flex", gap: 8, alignItems: "center" }} data-ui="SharePage.changeGrantForm">
                          <input type="hidden" name="pageId" value={pageId} />
                          <input type="hidden" name="groupId" value={g.groupId} />
                          <AccessSelect defaultValue={g.access} />
                          <button type="submit" className={styles.button} data-ui="SharePage.changeGrantButton">
                            {t("share.change")}
                          </button>
                        </form>
                      </td>
                      <td>
                        <form action={removeGrant} data-ui="SharePage.removeGrantForm">
                          <input type="hidden" name="pageId" value={pageId} />
                          <input type="hidden" name="groupId" value={g.groupId} />
                          <button type="submit" className={styles.danger} data-ui="SharePage.removeGrantButton">
                            {t("share.remove")}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {inheritedRows.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t("share.inherited")}</h2>
            <p className={styles.note} style={{ marginBottom: 12 }}>
              {t("share.inheritedLead")}
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("share.group")}</th>
                    <th>{t("share.inheritedFrom")}</th>
                    <th>{t("share.access")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {inheritedRows.map((r) => {
                    const override = overrideOf.get(r.groupId);
                    return (
                      <tr key={r.groupId} data-ui="SharePage.inheritedGrantRow" data-id={r.groupId}>
                        <td>{groupName(t, r.group!)}</td>
                        <td>
                          {ancestorTitle(r.pageId)}: {ta(r.access)}
                        </td>
                        <td>
                          {r.access === "MANAGE" || r.access === "NONE" ? (
                            <span className={styles.note} data-ui="SharePage.inheritedFixed">
                              {ta(r.access)} ({r.access === "MANAGE" ? t("share.inheritedFixed") : t("share.inheritedNoneAbove")})
                            </span>
                          ) : (
                            <form action={setGrant} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-ui="SharePage.overrideForm">
                              <input type="hidden" name="pageId" value={pageId} />
                              <input type="hidden" name="groupId" value={r.groupId} />
                              <AccessSelect defaultValue={override ?? r.access} options={narrowerOrEqual(r.access)} />
                              <button type="submit" className={styles.button} data-ui="SharePage.overrideButton">
                                {t("share.change")}
                              </button>
                              {override && (
                                <span className={styles.badge} data-ui="SharePage.overriddenStatus">
                                  {t("share.overridden")}
                                </span>
                              )}
                            </form>
                          )}
                        </td>
                        <td>
                          {override && (
                            <form action={removeGrant} data-ui="SharePage.revertForm">
                              <input type="hidden" name="pageId" value={pageId} />
                              <input type="hidden" name="groupId" value={r.groupId} />
                              <button type="submit" className={styles.buttonSecondary} data-ui="SharePage.revertButton">
                                {t("share.revert")}
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("share.add")}</h2>
          {addable.length === 0 ? (
            <p className={styles.note}>{t("share.noGroups")}</p>
          ) : (
            <form action={setGrant} className={styles.form} style={{ gridTemplateColumns: "1fr auto auto", alignItems: "end" }} data-ui="SharePage.addGrantForm">
              <input type="hidden" name="pageId" value={pageId} />
              <label>
                {t("share.group")}
                <select name="groupId" className={styles.field} data-ui="SharePage.groupSelect">
                  {addable.map((g) => (
                    <option key={g.id} value={g.id}>
                      {groupName(t, g)}
                    </option>
                  ))}
                </select>
              </label>
              <AccessSelect />
              <button type="submit" className={styles.button} data-ui="SharePage.addGrantButton">
                {t("share.give")}
              </button>
            </form>
          )}
        </section>

        {/* Only where it can apply: allowed by a site admin, or already set. */}
        {!page.personal && (publicAllowed || ownPublic || publicAbove) && (
          <section className={styles.section} data-ui="SharePage.publicSection">
            <h2 className={styles.sectionTitle}>{t("share.publicHeading")}</h2>
            <p className={styles.note} style={{ marginBottom: 12 }} data-ui="SharePage.publicStatus">
              {ownPublic
                ? t("share.publicOwn")
                : publicAbove
                  ? t("share.publicAbove", { page: ancestorTitle(publicAbove.id) })
                  : t("share.publicNone")}
              {!publicAllowed && (ownPublic || publicAbove) && t("share.publicNotAllowed")}
            </p>
            {ownPublic ? <UnpublishForm pageId={pageId} /> : !publicAbove && publicAllowed && <PublishForm pageId={pageId} />}
          </section>
        )}
      </div>
    </AppShell>
  );
}
