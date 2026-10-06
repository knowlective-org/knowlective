import Link from "next/link";
import { MAX_PAGE_DEPTH, getVisibleTrees, type VisiblePage } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { displayTitle } from "@/lib/page-title";
import styles from "@/styles/ui.module.css";
import { logout } from "./actions";

function PageLink({ page }: { page: VisiblePage }) {
  return (
    <Link href={`/pages/${page.id}`} style={{ textDecoration: "underline" }}>
      {page.icon ? `${page.icon} ` : ""}
      {displayTitle(page.title)}
    </Link>
  );
}

// Nested list of a page's visible descendants. `seen` and the depth cap keep
// a corrupted tree (cycle, runaway depth) from rendering forever.
function PageTree({
  parentId,
  childrenOf,
  depth,
  seen,
}: {
  parentId: string;
  childrenOf: Map<string, VisiblePage[]>;
  depth: number;
  seen: Set<string>;
}) {
  const children = (childrenOf.get(parentId) ?? []).filter((p) => !seen.has(p.id));
  if (children.length === 0 || depth > MAX_PAGE_DEPTH) return null;
  children.forEach((p) => seen.add(p.id));
  return (
    <ul style={{ paddingLeft: 20, lineHeight: 2 }}>
      {children.map((page) => (
        <li key={page.id}>
          <PageLink page={page} />
          <PageTree parentId={page.id} childrenOf={childrenOf} depth={depth + 1} seen={seen} />
        </li>
      ))}
    </ul>
  );
}

function Entry({ page, childrenOf, asHeading }: { page: VisiblePage; childrenOf: Map<string, VisiblePage[]>; asHeading: boolean }) {
  return (
    <section className={styles.section} style={asHeading ? undefined : { marginBottom: 16 }}>
      <h2 className={styles.sectionTitle} style={asHeading ? undefined : { fontSize: 16 }}>
        <PageLink page={page} />
      </h2>
      <PageTree parentId={page.id} childrenOf={childrenOf} depth={1} seen={new Set([page.id])} />
    </section>
  );
}

export default async function Home() {
  const user = await requireUser("/");
  // Only pages the user's groups grant are listed (site roles grant nothing).
  const trees = await getVisibleTrees(prisma, user.id);

  const roots: { page: VisiblePage; childrenOf: Map<string, VisiblePage[]> }[] = [];
  // Visible pages whose parent isn't visible (e.g. a grant on a subtree).
  // Their root's name isn't shown: the user can't see the root page.
  const shared: { page: VisiblePage; childrenOf: Map<string, VisiblePage[]> }[] = [];
  for (const tree of trees) {
    const childrenOf = new Map<string, VisiblePage[]>();
    for (const p of tree.pages) {
      if (p.parentId) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p]);
    }
    for (const id of tree.entryIds) {
      const page = tree.pages.find((p) => p.id === id)!;
      (id === tree.rootPageId ? roots : shared).push({ page, childrenOf });
    }
  }

  return (
    <main className={styles.wide}>
      <header className={styles.header}>
        <h1 className={styles.title} style={{ margin: 0 }}>
          yosuga
        </h1>
        <form action={logout} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={styles.note}>{user.name ?? user.email}</span>
          <button type="submit" className={styles.button}>
            ログアウト
          </button>
        </form>
      </header>

      {roots.length === 0 && shared.length === 0 && (
        <p className={styles.lead}>見られるページはまだありません。グループに追加されると、ここに表示されます。</p>
      )}
      {roots.map(({ page, childrenOf }) => (
        <Entry key={page.id} page={page} childrenOf={childrenOf} asHeading />
      ))}
      {shared.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>共有されたページ</h2>
          {shared.map(({ page, childrenOf }) => (
            <Entry key={page.id} page={page} childrenOf={childrenOf} asHeading={false} />
          ))}
        </section>
      )}
    </main>
  );
}
