"use client";

import { useMemo } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { getCollabToken } from "@/app/(app)/actions";

const CURSOR_COLORS = ["#5b8def", "#e5484d", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f"];

// Stable per-user cursor color.
function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

// Connects to the apps/collab Hocuspocus server and syncs a BlockNote
// document over Yjs. The collab server authorizes each connection with a
// short-lived token minted by the getCollabToken Server Action; the provider
// calls it again on every reconnect.
export function CollaborativeEditor({
  pageId,
  readOnly,
  user,
}: {
  pageId: string;
  readOnly: boolean;
  user: { id: string; name: string };
}) {
  const provider = useMemo(
    () =>
      new HocuspocusProvider({
        url: process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:1234",
        name: pageId,
        document: new Y.Doc(),
        token: () => getCollabToken(pageId),
      }),
    [pageId],
  );

  const editor = useCreateBlockNote(
    withCollaboration({
      collaboration: {
        fragment: provider.document.getXmlFragment("blocknote"),
        user: { name: user.name, color: colorFor(user.id) },
        provider: { awareness: provider.awareness ?? undefined },
      },
    }),
    [provider],
  );

  return <BlockNoteView editor={editor} editable={!readOnly} />;
}
