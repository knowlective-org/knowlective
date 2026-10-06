"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-fetches the current page's server data when the user comes back to it,
// so role and permission changes made elsewhere show up without signing in
// again. Next.js already refetches dynamic pages on normal navigation, but
// not for a tab left open or a back/forward navigation (served from its
// client cache). router.refresh() keeps client state (editor content,
// scroll position).
const MIN_INTERVAL_MS = 5_000;

export function RefreshOnReturn() {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (Date.now() - last < MIN_INTERVAL_MS) return;
      last = Date.now();
      router.refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // Back/forward: popstate for in-app history, pageshow for the browser's
    // back-forward cache.
    const onBackForward = () => {
      last = 0;
      refresh();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onBackForward();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("popstate", onBackForward);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("popstate", onBackForward);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}
