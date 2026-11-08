"use client";

import { StaticDocument } from "@/components/static-document";
import { StaticWhiteboard } from "@/components/whiteboard/static-whiteboard";

// A saved version, rendered read-only by the same editor (and schema) as the
// page. Child-page blocks show the page's current children, not those at the time.
export function VersionPreview({ pageId, whiteboard, state }: { pageId: string; whiteboard: boolean; state: string }) {
  if (whiteboard) return <StaticWhiteboard state={state} dataUi="VersionPreview" />;
  return <StaticDocument pageId={pageId} state={state} dataUi="VersionPreview" />;
}
