"use client";

import dynamic from "next/dynamic";

// BlockNote + the Yjs/Hocuspocus provider touch `window` during setup, so the
// editor must never run during SSR. `ssr: false` is only allowed in a Client
// Component, hence this small wrapper.
export const EditorLoader = dynamic(
  () => import("@/components/collaborative-editor").then((m) => m.CollaborativeEditor),
  { ssr: false },
);
