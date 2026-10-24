// Emails (lib/mail-templates.ts).

export default {
  mail: {
    invitation: {
      subject: "Your invitation to KNOWLECTIVE",
      invitedBy: "{inviter} has invited you to KNOWLECTIVE as {role}.",
      administrator: "A KNOWLECTIVE administrator",
      role: {
        SITE_ADMIN: "a site admin",
        CONTENT_MANAGER: "a content manager",
        USER: "a user",
      },
      groups: "Once registered, you'll join these groups: {groups}",
      open: "Open this link to create your account:",
      expires: "The link works once and expires in {duration}.",
      ignore: "If you weren't expecting this, you can ignore this email.",
    },
    signup: {
      subject: "Create your KNOWLECTIVE account",
      received: "We received a request to create a KNOWLECTIVE account for this address.",
      open: "Open this link to choose your display name and password:",
      expires: "The link works once and expires in {duration}.",
      ignore: "If you didn't ask for this, you can ignore this email (no account will be created).",
    },
    alreadyRegistered: {
      subject: "About your KNOWLECTIVE registration",
      exists: "Someone asked to create a KNOWLECTIVE account for this address, but it already has one.",
      login: "Log in here:",
      forgot: "If you don't know your password, reset it from \"{forgotLink}\" on the login screen.",
      ignore: "If you didn't ask for this, you can ignore this email.",
    },
    passwordReset: {
      subject: "Reset your KNOWLECTIVE password",
      requested: "We received a request to reset your KNOWLECTIVE password.",
      issuedByAdmin: "An administrator has issued a link for resetting your KNOWLECTIVE password.",
      open: "Open this link to set a new password:",
      expires: "The link works once and expires in {duration}. Resetting your password logs you out on every device.",
      ignore: "If you didn't ask for this, you can ignore this email (your password stays the same).",
    },
    emailCode: {
      subject: "Your KNOWLECTIVE confirmation code: {code}",
      intro: "Enter this code in KNOWLECTIVE to confirm it's you and issue an API key:",
      expires: "The code works once and expires in {duration}.",
      ignore: "If you didn't ask for this, someone may be signed in to your account: change your password, and tell an administrator.",
    },
    test: {
      subject: "KNOWLECTIVE test email",
      body: "This is a test email sent from the KNOWLECTIVE admin console.",
      works: "If you received it, the mail settings work.",
    },
  },
} as const;
