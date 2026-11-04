"use client";

import { useEffect, useState } from "react";
import { loadPagePeople, type PagePeople } from "@/app/(app)/pages/[pageId]/people-actions";

// The people who can open the page, with their names: for TODOs (whom to
// give one to, who ticked it) and mentions (whom to mention, their names).
// Loaded once for every block on the page, and again after a minute (for
// those given access since). null: not loaded yet, or someone not logged in.

const cache = new Map<string, Promise<PagePeople | null>>();

export function pagePeople(pageId: string): Promise<PagePeople | null> {
  let load = cache.get(pageId);
  if (!load) {
    load = loadPagePeople(pageId).catch(() => null);
    cache.set(pageId, load);
    setTimeout(() => cache.delete(pageId), 60_000);
  }
  return load;
}

export function usePagePeople(pageId: string): PagePeople | null {
  const [people, setPeople] = useState<PagePeople | null>(null);
  useEffect(() => {
    let alive = true;
    void pagePeople(pageId).then((result) => {
      if (alive) setPeople(result);
    });
    return () => {
      alive = false;
    };
  }, [pageId]);
  return people;
}
