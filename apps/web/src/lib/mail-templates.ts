import type { SiteRole } from "shared";

// Plain-text email bodies sent by the app. Links must be built from
// getPublicUrl(), never from request headers. Callers pass values only (no
// wording), so all of an email's text is here.

type Mail = { subject: string; text: string };

const ROLE_NAMES: Record<SiteRole, string> = {
  SITE_ADMIN: "a site admin",
  CONTENT_MANAGER: "a content manager",
  USER: "a user",
};

// "30 minutes", "1 hour", "24 hours", "7 days".
function duration(minutes: number): string {
  const day = 24 * 60;
  const [n, unit] =
    minutes >= 2 * day && minutes % day === 0
      ? [minutes / day, "day"]
      : minutes % 60 === 0
        ? [minutes / 60, "hour"]
        : [minutes, "minute"];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function invitationMail(input: {
  link: string;
  // null: invited by an admin signed in with the master password.
  inviterName: string | null;
  siteRole: SiteRole;
  groupNames: string[];
  ttlDays: number;
}): Mail {
  return {
    subject: "Your invitation to KNOWLECTIVE",
    text: [
      `${input.inviterName ?? "A KNOWLECTIVE administrator"} has invited you to KNOWLECTIVE as ${ROLE_NAMES[input.siteRole]}.`,
      ...(input.groupNames.length > 0 ? [`Once registered, you'll join these groups: ${input.groupNames.join(", ")}`] : []),
      "",
      "Open this link to create your account:",
      input.link,
      "",
      `The link works once and expires in ${duration(input.ttlDays * 24 * 60)}.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}

// /signup: confirms the address and opens the registration page.
export function signupMail(input: { link: string; ttlHours: number }): Mail {
  return {
    subject: "Create your KNOWLECTIVE account",
    text: [
      "We received a request to create a KNOWLECTIVE account for this address.",
      "",
      "Open this link to choose your display name and password:",
      input.link,
      "",
      `The link works once and expires in ${duration(input.ttlHours * 60)}.`,
      "If you didn't ask for this, you can ignore this email (no account will be created).",
    ].join("\n"),
  };
}

// /signup for an address that already has an account. Sent instead of a
// registration link, so the form itself never reveals who is registered.
export function alreadyRegisteredMail(input: { loginLink: string }): Mail {
  return {
    subject: "About your KNOWLECTIVE registration",
    text: [
      "Someone asked to create a KNOWLECTIVE account for this address, but it already has one.",
      "",
      "Log in here:",
      input.loginLink,
      "",
      "If you don't know your password, reset it from \"Forgot your password?\" on the login screen.",
      "If you didn't ask for this, you can ignore this email.",
    ].join("\n"),
  };
}

// /forgot-password, or a link a site admin chose to mail from /admin/users.
export function passwordResetMail(input: { link: string; ttlMinutes: number; byAdmin: boolean }): Mail {
  return {
    subject: "Reset your KNOWLECTIVE password",
    text: [
      input.byAdmin
        ? "An administrator has issued a link for resetting your KNOWLECTIVE password."
        : "We received a request to reset your KNOWLECTIVE password.",
      "",
      "Open this link to set a new password:",
      input.link,
      "",
      `The link works once and expires in ${duration(input.ttlMinutes)}. Resetting your password logs you out on every device.`,
      "If you didn't ask for this, you can ignore this email (your password stays the same).",
    ].join("\n"),
  };
}

// The admin console's test email (overview → mail settings).
export function testMail(): Mail {
  return {
    subject: "KNOWLECTIVE test email",
    text: [
      "This is a test email sent from the KNOWLECTIVE admin console.",
      "If you received it, the mail settings work.",
    ].join("\n"),
  };
}
