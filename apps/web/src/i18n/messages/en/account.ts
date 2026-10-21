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
    passkeys: {
      heading: "Passkeys",
      lead: "Log in with a passkey (fingerprint, face, or the device's PIN) instead of your password. Your password keeps working too.",
      leadRequired: "This site requires a passkey to log in: your password no longer logs you in. Register one on each device you use, or keep one on your phone.",
      none: "No passkeys registered.",
      name: "Name",
      namePlaceholder: "e.g. work laptop",
      defaultName: "Passkey",
      createdAt: "Registered",
      lastUsedAt: "Last used",
      register: "Register a passkey",
      registering: "Registering…",
      remove: "Remove",
      removeTitle: "Remove this passkey?",
      removeConfirm: "Remove the passkey \"{name}\"? You can no longer log in with it.",
      removeFailed: "Can't remove the passkey",
      lastRequiredNote: "The site requires a passkey: register another one before removing this one.",
      unsupported: "This browser can't use passkeys.",
      errors: {
        signedOut: "You've been logged out. Please log in again.",
        nameTooLong: "Keep the name to {max, number} characters.",
        expired: "The registration expired. Please try again.",
        invalid: "The passkey couldn't be registered. Please try again.",
        notFound: "This passkey can't be found.",
        lastRequired: "The site requires a passkey, so the last one can't be removed. Register another one first.",
        alreadyRegistered: "This device already has a passkey for your account.",
        browser: "The browser couldn't create a passkey. Please try again.",
      },
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
