"use client";

import dynamic from "next/dynamic";
import { EditorPlaceholder } from "@/components/editor-placeholder";

// BlockNote + the Yjs/Hocuspocus provider touch `window` during setup, so the
// editor must never run during SSR. `ssr: false` is only allowed in a Client
// Component, hence this small wrapper.
export const EditorLoader = dynamic(
  () => import("@/components/collaborative-editor").then((m) => m.CollaborativeEditor),
  // Also shown during SSR and while the editor's code downloads.
  { ssr: false, loading: () => <EditorPlaceholder /> },
);

// For someone not logged in on a public page: the page as it was when opened,
// read-only and not connected to collaborative editing (lib/public-page-state.ts).
export const StaticDocumentLoader = dynamic(
  () => import("@/components/static-document").then((m) => m.StaticDocument),
  { ssr: false, loading: () => <EditorPlaceholder /> },
);
