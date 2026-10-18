// The account screen ((app)/account).

export default {
  account: {
    title: "Account",
    // The title a personal knowledge root starts with.
    personalRootTitle: "My pages",
    details: "Your details",
    name: "Name",
    email: "Email address",
    role: "Role",
    language: {
      heading: "Display language",
      label: "Language",
      browser: "Same as the browser",
      note: "The language of the screens and of the emails sent to you.",
    },
    passwordReset: {
      heading: "Reset your password",
      ssoUnavailable: "This account logs in with single sign-on, so its password can't be reset here.",
      mailUnavailable:
        "Email sending isn't set up, so the password can't be reset here. If you need to reset it, contact an administrator (they can issue a reset link).",
      explain: "We'll email {email} a link for setting a new password. Your current password stays until you open it.",
      submit: "Send the reset link",
      sent: "We've emailed {email} a reset link (valid for {duration}).",
      sentNote: "Setting a new password from the link logs you out on every screen. Log in again with the new password.",
    },
    errors: {
      ssoAccount: "This account logs in with single sign-on, so its password can't be reset.",
      tooMany: "Too many reset emails in a row. Please wait a while and try again.",
      mailFailed: "The email couldn't be sent. Please try again later, or contact an administrator.",
    },
  },
} as const;
