"use client";

import { useEffect } from "react";
import { withBasePath } from "@/lib/base-path";

// The knowledge root's favicon (lib/root-favicon.ts) in the browser's tab
// while one of its pages is open; the site's icon again when it's left.
// Done here rather than in the page's metadata, which can't take the site's
// icon (lib/site-favicon.ts, set in the root layout) away. The site's icon
// links are set aside (their rel changed) while ours is in, so it's the one
// the browser uses, and put back as they were.
export function RootFavicon({ href }: { href: string | null }) {
  useEffect(() => {
    if (!href) return;
    const theirs = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]:not([data-root-favicon])')];
    for (const link of theirs) {
      link.dataset.knRel = link.rel;
      link.rel = "knowlective-site-icon";
    }
    const ours = document.createElement("link");
    ours.rel = "icon";
    ours.href = withBasePath(href);
    ours.dataset.rootFavicon = "";
    document.head.append(ours);
    return () => {
      ours.remove();
      for (const link of theirs) {
        if (link.dataset.knRel) link.rel = link.dataset.knRel;
        delete link.dataset.knRel;
      }
    };
  }, [href]);
  return null;
}
