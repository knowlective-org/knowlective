"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MAX_PAGE_DEPTH, createCollabToken } from "shared";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { normalizeTitle } from "@/lib/page-title";
import { type CreatePageError, insertChildPage } from "@/lib/page-create";
import { endUserSession, getCurrentUser, requireUser } from "@/lib/auth/session";
import { getAllowedUploadExtensions, getUploadsEnabled } from "@/lib/storage";
import { COLLAB_CLIENT_VERSION, OUTDATED_CLIENT } from "@/lib/collab-version";

// auth: public — ends whatever session the caller has (none: nothing to end).
export async function logout(): Promise<void> {
  await endUserSession();
  redirect("/login");
}

// Called by the editor each time it (re)connects to the collab server, so the
// short-lived token is always fresh and membership is re-checked. Someone not
// logged in gets one for a public page, as user "" (the collab server checks
// public access again and makes the connection read-only).
// Only for people logged in: someone not logged in sees a public page's
// content without collaborative editing (lib/public-page-state.ts).
// `version` is the editor's (lib/collab-version.ts): an editor from before
// the app's current version (including one that sends none) gets
// OUTDATED_CLIENT instead, and asks to reload.
export async function getCollabToken(pageId: string, version?: number): Promise<string> {
  const user = await getCurrentUser();
  if (!user || typeof pageId !== "string" || !(await findAccessiblePage(user.id, pageId))) {
    throw new Error("Page not found");
  }
  if (version !== COLLAB_CLIENT_VERSION) return OUTDATED_CLIENT;
  return createCollabToken(user.id, pageId, COLLAB_CLIENT_VERSION);
}

// Whether files can be added at all, and the extensions of those that may be
// (empty = any), so the editor can refuse a file before asking what to do
// with it. The upload route checks again.
export async function getUploadPolicy(): Promise<{ enabled: boolean; extensions: string[] }> {
  await requireUser();
  const [enabled, extensions] = await Promise.all([getUploadsEnabled(), getAllowedUploadExtensions()]);
  return { enabled, extensions };
}

// The order of the knowledge roots in this user's sidebar (ids, first
// first). Only the user's own preference: it changes nothing for anyone
// else, and ids of roots they can't see are simply never shown. [] goes back
// to creation order.
export async function saveRootOrder(rootIds: string[]): Promise<{ error?: string }> {
  const user = await requireUser();
  if (
    !Array.isArray(rootIds) ||
    rootIds.length > 500 ||
    !rootIds.every((id) => typeof id === "string" && /^[a-z0-9]{1,40}$/i.test(id))
  ) {
    return { error: (await getTranslations("pageErrors"))("badOrder") };
  }
  await prisma.user.update({ where: { id: user.id }, data: { rootOrder: [...new Set(rootIds)] } });
  return {};
}

// The page creation's error, in the request's language.
async function createError(result: { error: CreatePageError }): Promise<{ error: string }> {
  const t = await getTranslations("pageErrors");
  if (result.error === "lockedWithChildren") return { error: t("lockedWithChildren") };
  if (result.error === "tooDeep") return { error: t("tooDeep", { max: MAX_PAGE_DEPTH }) };
  return { error: t("cannotCreateHere") };
}

// Creates an untitled child page under `parentId` and opens it (the
// sidebar's + button, and its whiteboard button for `whiteboard`).
export async function createChildPage(parentId: string, whiteboard = false): Promise<{ error: string }> {
  const user = await requireUser();
  const result = await insertChildPage(user.id, parentId, "", whiteboard === true ? "WHITEBOARD" : "DOCUMENT");
  if ("error" in result) return createError(result);
  redirect(`/pages/${result.id}`);
}

// Creates a child page with a title and stays on the current page (child-page
// table's "new page" row).
export async function createChildPageInPlace(parentId: string, title: string): Promise<{ id: string } | { error: string }> {
  const user = await requireUser();
  const result = await insertChildPage(user.id, parentId, normalizeTitle(typeof title === "string" ? title : ""));
  return "error" in result ? createError(result) : result;
}
