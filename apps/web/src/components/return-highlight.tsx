"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { markFor, RETURN_MARK_KEY, screenOf, type ReturnMark } from "@/lib/return-mark";
import { sameSitePath } from "@/lib/same-site-link";
import styles from "./return-highlight.module.css";

// Coming back to a screen (a list, a table, a page…) after following a link
// on it: the link followed, and the row, card or cell it's in, is marked for a
// moment (scrolled into view if needed), to show where one was. Links in the
// right pane only (the sidebar marks the open page itself), to another
// screen of this site, followed in the same tab. The mark is an element over
// the target (fixed, following it), not a change to it: the editor's own DOM
// is left alone. Kept per tab (sessionStorage), shown once.
export function ReturnHighlight() {
  const pathname = usePathname();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || !link.closest(MAIN) || link.closest(SKIP)) return;
      const to = linkPath(link);
      const from = currentScreen();
      if (to === null || screenOf(to) === from) return;
      const n = mainLinks(to).indexOf(link);
      save({ from, to, n: Math.max(0, n), at: Date.now() });
    };
    // Capture: seen even when the link's own handler stops the event.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const mark = markFor(load(), currentScreen(), Date.now());
    if (!mark) return;
    save(null);
    // The screen's content may come later (child pages, tables, the editor):
    // looked for as it's added, for a while.
    const find = () => {
      const links = mainLinks(mark.to);
      return links[mark.n] ?? links[0] ?? null;
    };
    let stopMark: (() => void) | null = null;
    const show = (link: HTMLAnchorElement) => {
      observer.disconnect();
      window.clearTimeout(giveUp);
      stopMark = markElement(link.closest(TARGET) ?? link);
    };
    const observer = new MutationObserver(() => {
      const link = find();
      if (link) show(link);
    });
    const giveUp = window.setTimeout(() => observer.disconnect(), 10_000);
    const first = find();
    if (first) show(first);
    else observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
      stopMark?.();
    };
  }, [pathname]);

  return null;
}

const MAIN = '[data-ui="AppShell.main"]';
// The page's bar (breadcrumb): not a list one comes back to.
const SKIP = '[data-ui="PageView.toolbar"]';
// What's marked around the link: its row, card, cell or item.
const TARGET = '[role="row"], .kn-grid-cell, [data-ui$=".card"], [data-ui$="Row"], [data-ui$="Item"], [role="listitem"]';
const SHOW_MS = 2400;

function currentScreen(): string {
  let path = window.location.pathname;
  if (BASE_PATH && path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length) || "/";
  return screenOf(`${path}${window.location.search}`);
}

function linkPath(link: HTMLAnchorElement): string | null {
  return sameSitePath(link.href, window.location.origin, BASE_PATH);
}

function mainLinks(to: string): HTMLAnchorElement[] {
  const main = document.querySelector(MAIN);
  if (!main) return [];
  return [...main.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => !a.closest(SKIP) && linkPath(a) === to);
}

function load(): string | null {
  try {
    return sessionStorage.getItem(RETURN_MARK_KEY);
  } catch {
    return null;
  }
}

function save(mark: ReturnMark | null) {
  try {
    if (mark) sessionStorage.setItem(RETURN_MARK_KEY, JSON.stringify(mark));
    else sessionStorage.removeItem(RETURN_MARK_KEY);
  } catch {
    // No storage (private window, blocked): no mark.
  }
}

// A frame over `target` for a moment, following it as the page scrolls.
function markElement(target: Element): () => void {
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return () => {};
  if (rect.bottom < 0 || rect.top > window.innerHeight) target.scrollIntoView({ block: "center" });
  const mark = document.createElement("div");
  mark.className = styles.mark;
  mark.setAttribute("aria-hidden", "true");
  mark.dataset.ui = "ReturnHighlight.mark";
  document.body.append(mark);
  let frame = 0;
  const place = () => {
    const r = target.getBoundingClientRect();
    mark.style.top = `${r.top - 3}px`;
    mark.style.left = `${r.left - 3}px`;
    mark.style.width = `${r.width + 6}px`;
    mark.style.height = `${r.height + 6}px`;
    frame = requestAnimationFrame(place);
  };
  place();
  const done = window.setTimeout(() => stop(), SHOW_MS);
  function stop() {
    cancelAnimationFrame(frame);
    window.clearTimeout(done);
    mark.remove();
  }
  return stop;
}
