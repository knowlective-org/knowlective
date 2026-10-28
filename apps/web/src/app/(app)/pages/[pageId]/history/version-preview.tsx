"use client";

import { StaticDocument } from "@/components/static-document";

// A saved version, rendered read-only by the same editor (and schema) as the
// page. Child-page blocks show the page's current children, not those at the time.
export function VersionPreview({ pageId, state }: { pageId: string; state: string }) {
  return <StaticDocument pageId={pageId} state={state} dataUi="VersionPreview" />;
}
