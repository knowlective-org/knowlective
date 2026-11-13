import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { shortcutTarget } from "@/lib/shortcuts";
import { loadPage } from "./load-page";

// Turns the viewer away before anything of the page is sent: a page they
// can't open is a 404, the login screen for someone not logged in (unless
// the page is public), and a shortcut sends them to its page. It's here, not
// in page.tsx, because loading.tsx (the loading overlay) wraps the page: once
// it's shown the response has begun, and a 404 or a redirect from the page
// would come as 200 (the not-found screen, a redirect in the browser). A
// layout of the same folder is outside it.
export default async function PageGate({ children, params }: LayoutProps<"/pages/[pageId]">) {
  await connection();
  const { user, page } = await loadPage((await params).pageId);
  if (!page) notFound();
  // A shortcut opens its target, if the viewer can open that (their own
  // access to it, not the shortcut's); otherwise there's nothing here.
  if (page.kind === "SHORTCUT") {
    const target = await shortcutTarget(user?.id ?? null, page.shortcutTargetId);
    if (!target) notFound();
    redirect(`/pages/${target}`);
  }
  return children;
}
