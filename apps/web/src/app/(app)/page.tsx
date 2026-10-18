import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPageAccess } from "shared";
import { prisma } from "@/lib/db";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { landingPageFor } from "@/lib/landing-page";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";

// "/" has no screen of its own: it reopens the page opened last, or else the
// top page set in /admin, or else the first page the user can see (a root
// page before shared pages). Only when nothing is visible does it render the
// empty two-pane screen. Someone not logged in gets the top page if it's
// public, and the login screen otherwise (see lib/landing-page.ts).
export default async function Home() {
  if (!(await getCurrentUser())) {
    const landing = await landingPageFor(null);
    if (landing) redirect(`/pages/${landing}`);
  }
  const user = await requireUser("/");
  const { lastPageId } = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { lastPageId: true },
  });
  if (lastPageId && (await getPageAccess(prisma, user.id, lastPageId))) {
    redirect(`/pages/${lastPageId}`);
  }
  const landing = await landingPageFor(user.id);
  if (landing) redirect(`/pages/${landing}`);

  const [sidebar, t] = await Promise.all([loadSidebar(user), getTranslations("home")]);
  const first =
    sidebar.trees.find((t) => t.rootPageId && t.entryIds.includes(t.rootPageId))?.rootPageId ??
    sidebar.trees[0]?.entryIds[0];
  if (first) redirect(`/pages/${first}`);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div style={{ padding: "0 54px" }} data-ui="EmptyHome">
        <h1 className={styles.title}>{t("welcome")}</h1>
        <p className={styles.lead}>
          {sidebar.canCreateRoot
            ? t("emptyCanCreate")
            : t("empty")}
        </p>
      </div>
    </AppShell>
  );
}
