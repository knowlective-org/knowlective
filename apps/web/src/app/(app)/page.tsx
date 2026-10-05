import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { MAX_PAGE_DEPTH } from "@/lib/knowledge-roots";
import styles from "@/styles/ui.module.css";
import { logout } from "./actions";

type TreePage = { id: string; title: string; icon: string | null; parentId: string | null };

function PageLink({ page }: { page: TreePage }) {
  return (
    <Link href={`/pages/${page.id}`} style={{ textDecoration: "underline" }}>
      {page.icon ? `${page.icon} ` : ""}
      {page.title}
    </Link>
  );
}

// Nested list of a page's descendants. `seen` and the depth cap keep a
// corrupted tree (cycle, runaway depth) from rendering forever.
function PageTree({
  parentId,
  childrenOf,
  depth,
  seen,
}: {
  parentId: string;
  childrenOf: Map<string, TreePage[]>;
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

export default async function Home() {
  const user = await requireUser("/");
  const memberships = await prisma.knowledgeRootMember.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      root: {
        select: {
          id: true,
          rootPageId: true,
          pages: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true, icon: true, parentId: true },
          },
        },
      },
    },
  });

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

      {memberships.length === 0 && (
        <p className={styles.lead}>参加しているナレッジルートはまだありません。</p>
      )}
      {memberships.map(({ root }) => {
        // A knowledge root is shown as its root page.
        const rootPage = root.pages.find((p) => p.id === root.rootPageId);
        if (!rootPage) return null;
        const childrenOf = new Map<string, TreePage[]>();
        for (const page of root.pages) {
          if (!page.parentId) continue;
          childrenOf.set(page.parentId, [...(childrenOf.get(page.parentId) ?? []), page]);
        }
        return (
          <section key={root.id} className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <PageLink page={rootPage} />
            </h2>
            {childrenOf.has(rootPage.id) ? (
              <PageTree
                parentId={rootPage.id}
                childrenOf={childrenOf}
                depth={1}
                seen={new Set([rootPage.id])}
              />
            ) : (
              <p className={styles.note}>子ページはまだありません。</p>
            )}
          </section>
        );
      })}
    </main>
  );
}
