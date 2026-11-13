import { cache } from "react";
import { findAccessiblePage } from "@/lib/auth/pages";
import { getCurrentUser, requireUser } from "@/lib/auth/session";

// The page and who's viewing it, shared by the layout (which turns the
// viewer away), generateMetadata and the page within one request. Someone
// not logged in may view a public page; any other page sends them to the
// login screen, as before (so it doesn't tell which pages exist).
export const loadPage = cache(async (pageId: string) => {
  const user = await getCurrentUser();
  if (user) return { user, page: await findAccessiblePage(user.id, pageId) };
  const page = await findAccessiblePage(null, pageId);
  if (!page) await requireUser(`/pages/${encodeURIComponent(pageId)}`);
  return { user: null, page };
});
