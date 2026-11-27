import { type ApiErrorCode, apiError } from "./http";
import type { ExportError } from "@/lib/page-transfer/export";
import type { ImportError, ImportResult } from "@/lib/page-transfer/import";
import { getPublicUrl } from "@/lib/site-url";

// The public API's side of copying pages (lib/page-transfer/): errors as API
// errors, and the result as JSON. MCP words them in lib/mcp/tools.ts.

export function exportProblem(error: ExportError): Response {
  switch (error) {
    case "not_found":
      return apiError("not_found");
    case "slide":
      return apiError("invalid_body", "A slide is copied with its presentation: export the presentation.");
    case "too_many_pages":
      return apiError("too_many_pages");
  }
}

const IMPORT_CODES: Record<ImportError["code"], ApiErrorCode> = {
  not_allowed: "not_found",
  locked: "page_locked",
  not_here: "conflict",
  too_deep: "too_deep",
  bad_url: "bad_link",
  unreachable: "link_unusable",
  bundle: "invalid_export",
  too_many_slides: "too_many_slides",
};

export function importProblem(error: ImportError): Response {
  if (error.code === "not_here") return apiError("conflict", "Pages can be copied under a document or a whiteboard only.");
  if (error.code === "bundle" && error.problem === "too_many_pages") return apiError("too_many_pages");
  return apiError(IMPORT_CODES[error.code]);
}

export async function importJson(result: ImportResult) {
  return {
    id: result.pageId,
    url: `${await getPublicUrl()}/pages/${result.pageId}`,
    pages: result.pages,
    files: result.files,
    peopleRemoved: result.peopleRemoved,
    sameSite: result.sameSite,
  };
}
