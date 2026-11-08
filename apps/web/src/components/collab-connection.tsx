"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getCollabToken } from "@/app/(app)/actions";
import { withBasePath } from "@/lib/base-path";
import { COLLAB_CLIENT_VERSION, OUTDATED_CLIENT } from "@/lib/collab-version";
import { PAGE_DELETED, PAGE_MOVED } from "@/lib/collab-events";
import { EditorPlaceholder } from "./editor-placeholder";

// The collaboration WebSocket is served by the same process and origin as the
// app (server/collab.ts, COLLAB_PATH), so no separate URL needs configuring.
export function collabUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${withBasePath("/collab")}`;
}

// Waits before reconnecting after a refused connection. Refusals are usually
// final (no access, page deleted), but can also be transient: the token
// request failing for a moment (network, a server restart or, in
// development, a recompile) or the server failing to check access. So the
// editor tries again a few times before saying the page can't be opened.
const RETRY_DELAYS_MS = [1000, 2000, 4000];

// Connects a page's Yjs document to the Hocuspocus collaboration server, for
// the page's editor (a document or a whiteboard). The collab server
// authorizes each connection with a short-lived token minted by the
// getCollabToken Server Action; the provider calls it again on every
// reconnect. Shows a placeholder until the first sync, and a message instead
// of the editor once the page can't be used any more.
export function CollabConnection({
  pageId,
  children,
}: {
  pageId: string;
  // What to show once the first sync is done.
  children: (provider: HocuspocusProvider) => ReactNode;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  // Bumped to replace the provider with a fresh one (new token, new socket).
  const [attempt, setAttempt] = useState(0);
  // Refusals since the last successful sync.
  const failures = useRef(0);
  // The provider whose first sync finished. Until then the document (and
  // its title) is empty, so the placeholder is shown instead.
  const [synced, setSynced] = useState<HocuspocusProvider | null>(null);
  // Shown instead of the editor once it can't be used any more.
  const [failure, setFailure] = useState<"openFailed" | "movedToTrash" | "outdated" | null>(null);
  const t = useTranslations("editor");

  // One connection per mounted page, closed when leaving it — navigating to
  // another page would otherwise leave the old socket open. The page screen
  // remounts this component per page (key={pageId}), so there's no stale
  // provider to reset on cleanup.
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // The app was updated since this screen was loaded: no retries.
    let outdated = false;
    const p = new HocuspocusProvider({
      url: collabUrl(),
      name: pageId,
      document: new Y.Doc(),
      token: async () => {
        const token = await getCollabToken(pageId, COLLAB_CLIENT_VERSION);
        if (token === OUTDATED_CLIENT) {
          outdated = true;
          throw new Error("Outdated editor");
        }
        return token;
      },
      onSynced: () => {
        failures.current = 0;
        setSynced(p);
      },
      // Also fires when getCollabToken() itself throws.
      onAuthenticationFailed: () => {
        if (outdated) {
          setFailure("outdated");
          return;
        }
        const delay = RETRY_DELAYS_MS[failures.current++];
        if (delay === undefined) {
          setFailure("openFailed");
          return;
        }
        retryTimer = setTimeout(() => setAttempt((n) => n + 1), delay);
      },
      onStateless: ({ payload }) => {
        try {
          const type = (JSON.parse(payload) as { type?: string }).type;
          if (type === PAGE_DELETED) {
            setFailure("movedToTrash");
          } else if (type === PAGE_MOVED) {
            // The server closes this connection next. Reconnect with a fresh
            // token (access is checked again), and refresh the screen: the
            // sidebar and this page's access may have changed.
            retryTimer = setTimeout(() => setAttempt((n) => n + 1), 0);
            router.refresh();
          }
        } catch {
          // Not ours.
        }
      },
    });
    // Opening the socket is a side effect tied to mount/unmount (and must
    // survive StrictMode's double effect run), so it can't happen in render.
    setProvider(p);
    return () => {
      clearTimeout(retryTimer);
      p.destroy();
    };
  }, [pageId, attempt, router]);

  if (failure) return <EditorPlaceholder message={t(failure)} reload={failure === "outdated" ? t("reload") : undefined} />;
  if (!provider || synced !== provider) return <EditorPlaceholder />;
  return children(provider);
}
