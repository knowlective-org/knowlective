import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MAX_PAGE_DEPTH, PUBLIC_GROUP, atLeast, getVisibleTree } from "shared";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { ACCESS_LABELS } from "@/lib/admin/format";
import { displayTitle } from "@/lib/page-title";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { removeGrant, setGrant } from "./actions";
import { PublishForm, UnpublishForm } from "./public-forms";
import { publicPagesAllowed } from "@/lib/public-pages";

export const metadata: Metadata = { title: "権限設定 | KNOWLECTIVE" };

const ERRORS: Record<string, string> = {
  "last-manager": "ルートページには「管理」の権限を持つグループが最低1つ必要です。先に別のグループに「管理」を付けてください。",
  invalid: "入力内容が不正です。",
  "public-not-allowed": "ページの公開は、管理画面で許可されていません。",
};

function AccessSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <select name="access" defaultValue={defaultValue ?? "VIEW"} className={styles.field} style={{ width: "auto", marginTop: 0 }} data-ui="AccessSelect">
      <option value="VIEW">閲覧</option>
      <option value="EDIT">編集</option>
      <option value="MANAGE">管理</option>
    </select>
  );
}

export default async function SharePage({ params, searchParams }: PageProps<"/pages/[pageId]/share">) {
  const { pageId } = await params;
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}/share`);
  const page = await findAccessiblePage(user.id, pageId);
  if (!page) notFound();
  if (!atLeast(page.access, "MANAGE")) redirect(`/pages/${pageId}`);
  const error = ERRORS[String((await searchParams).error ?? "")];

  // Ancestors, nearest first, for showing inherited grants.
  const ancestors: { id: string; title: string }[] = [];
  let cursor = (await prisma.page.findUnique({ where: { id: pageId }, select: { parentId: true } }))?.parentId ?? null;
  for (let i = 0; cursor && i < MAX_PAGE_DEPTH; i++) {
    const p = await prisma.page.findUnique({ where: { id: cursor }, select: { id: true, title: true, parentId: true } });
    if (!p) break;
    ancestors.push({ id: p.id, title: p.title });
    cursor = p.parentId;
  }
  const [allOwn, allInherited, groups, tree, sidebar, publicAllowed] = await Promise.all([
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
  ]);
  // The public group has a section of its own (「インターネットに公開」).
  const isPublic = (g: { builtIn: string | null }) => g.builtIn === PUBLIC_GROUP;
  const own = allOwn.filter((g) => !isPublic(g.group));
  const inherited = allInherited.filter((g) => !isPublic(g.group));
  const ownPublic = allOwn.some((g) => isPublic(g.group));
  // The nearest page above made public, if any.
  const publicAbove = ancestors.find((a) => allInherited.some((g) => g.pageId === a.id && isPublic(g.group))) ?? null;
  // Don't reveal titles of ancestors the manager itself can't see.
  const visible = new Set(tree?.pages.map((p) => p.id) ?? []);
  const ancestorTitle = (id: string) => {
    const a = ancestors.find((x) => x.id === id);
    return a && visible.has(a.id) ? `「${displayTitle(a.title)}」` : "（権限のない上位ページ）";
  };
  const ownGroupIds = new Set(own.map((g) => g.groupId));
  // Nearest ancestor grant per group, ignoring groups overridden on this page.
  const inheritedByGroup = new Map<string, (typeof inherited)[number]>();
  for (const a of ancestors) {
    for (const g of inherited.filter((x) => x.pageId === a.id)) {
      if (!ownGroupIds.has(g.groupId) && !inheritedByGroup.has(g.groupId)) inheritedByGroup.set(g.groupId, g);
    }
  }
  const addable = groups.filter((g) => !ownGroupIds.has(g.id) && !isPublic(g));

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={pageId} />}>
      <div className={styles.pane} data-ui="SharePage">
        <p className={styles.note} style={{ marginBottom: 16 }}>
          <Link href={`/pages/${pageId}`} style={{ textDecoration: "underline" }} data-ui="SharePage.backLink">
            ← ページに戻る
          </Link>
        </p>
        <h1 className={styles.title}>「{displayTitle(page.title)}」の権限設定</h1>
        <p className={styles.lead}>
          権限はグループに付け、配下のページにも引き継がれます。同じグループに下のページで別の権限を付けると、そこから下はその権限になります。
          {page.isRootPage && " これはナレッジルートのルートページです。「管理」を持つグループが最低1つ必要です。"}
        </p>
        {error && (
          <p className={styles.error} style={{ marginBottom: 16 }} data-ui="SharePage.error">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>このページに付いている権限</h2>
          {own.length === 0 ? (
            <p className={styles.note}>このページに直接付いている権限はありません。</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>グループ</th>
                    <th>メンバー数</th>
                    <th>権限</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {own.map((g) => (
                    <tr key={g.id} data-ui="SharePage.grantRow" data-id={g.groupId}>
                      <td>{g.group.name}</td>
                      <td>{g.group.builtIn ? "全員（自動）" : g.group._count.members}</td>
                      <td>
                        <form action={setGrant} style={{ display: "flex", gap: 8, alignItems: "center" }} data-ui="SharePage.changeGrantForm">
                          <input type="hidden" name="pageId" value={pageId} />
                          <input type="hidden" name="groupId" value={g.groupId} />
                          <AccessSelect defaultValue={g.access} />
                          <button type="submit" className={styles.button} data-ui="SharePage.changeGrantButton">
                            変更
                          </button>
                        </form>
                      </td>
                      <td>
                        <form action={removeGrant} data-ui="SharePage.removeGrantForm">
                          <input type="hidden" name="pageId" value={pageId} />
                          <input type="hidden" name="groupId" value={g.groupId} />
                          <button type="submit" className={styles.danger} data-ui="SharePage.removeGrantButton">
                            外す
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

        {inheritedByGroup.size > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>上位のページから引き継いでいる権限</h2>
            <ul className={styles.note} style={{ paddingLeft: 20, lineHeight: 1.9 }}>
              {[...inheritedByGroup.values()].map((g) => (
                <li key={g.id} data-ui="SharePage.inheritedGrantRow" data-id={g.groupId}>
                  {g.group.name}：{ACCESS_LABELS[g.access]}（{ancestorTitle(g.pageId)}から）
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>グループに権限を付ける</h2>
          {addable.length === 0 ? (
            <p className={styles.note}>追加できるグループがありません。グループは管理画面の「グループ」で作成できます。</p>
          ) : (
            <form action={setGrant} className={styles.form} style={{ gridTemplateColumns: "1fr auto auto", alignItems: "end" }} data-ui="SharePage.addGrantForm">
              <input type="hidden" name="pageId" value={pageId} />
              <label>
                グループ
                <select name="groupId" className={styles.field} data-ui="SharePage.groupSelect">
                  {addable.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <AccessSelect />
              <button type="submit" className={styles.button} data-ui="SharePage.addGrantButton">
                付ける
              </button>
            </form>
          )}
        </section>

        {/* Only where it can apply: allowed by a site admin, or already set. */}
        {!page.personal && (publicAllowed || ownPublic || publicAbove) && (
          <section className={styles.section} data-ui="SharePage.publicSection">
            <h2 className={styles.sectionTitle}>インターネットに公開</h2>
            <p className={styles.note} style={{ marginBottom: 12 }} data-ui="SharePage.publicStatus">
              {ownPublic
                ? "このページと、その下のすべてのページを公開しています。ログインしていない人も、URL を知っていれば閲覧できます。"
                : publicAbove
                  ? `上位のページ${ancestorTitle(publicAbove.id)}の公開により、このページも公開されています。公開をやめるには、そのページの権限設定で行います。`
                  : "公開すると、このページと、その下のすべてのページを、ログインしていない人も閲覧できるようになります（編集はできません）。"}
              {!publicAllowed && (ownPublic || publicAbove) && " ただし、今は管理画面でページの公開が許可されていないため、公開されていません。"}
            </p>
            {ownPublic ? <UnpublishForm pageId={pageId} /> : !publicAbove && publicAllowed && <PublishForm pageId={pageId} />}
          </section>
        )}
      </div>
    </AppShell>
  );
}
