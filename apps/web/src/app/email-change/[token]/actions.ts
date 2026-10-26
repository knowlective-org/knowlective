"use server";

import { getTranslations } from "next-intl/server";
import { completeEmailChange } from "@/lib/auth/email-change";

export type ConfirmEmailChangeState = { error?: string; done?: string };

// The link's confirm button: a POST, so opening the link (as mail scanners
// do) changes nothing.
export async function confirmEmailChange(
  _prev: ConfirmEmailChangeState,
  formData: FormData,
): Promise<ConfirmEmailChangeState> {
  const t = await getTranslations("emailChange.errors");
  const token = formData.get("token");
  const result = await completeEmailChange(typeof token === "string" ? token : "");
  if (!result.ok) return { error: result.reason === "taken" ? t("taken") : t("invalid") };
  return { done: result.email };
}
