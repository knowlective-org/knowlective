"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { sameSitePath } from "@/lib/same-site-link";

// Links to this site open in the same tab, even those written to open a new
// one (links in a page's text, chat messages, link previews, read-only
// pages): a click goes there with the app's own navigation. Links to other
// sites, files (/api), and clicks with a modifier key (new tab, new
// window) or the middle button are left as they are. The editor that can be
// written in handles its links itself (collaborative-editor.tsx: a browser
// doesn't follow links in editable content).
export function SameTabLinks() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target !== "_blank" || link.hasAttribute("download")) return;
      if (link.closest('[contenteditable="true"]')) return;
      const path = sameSitePath(link.href, window.location.origin, BASE_PATH);
      if (path === null) return;
      e.preventDefault();
      router.push(path);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
