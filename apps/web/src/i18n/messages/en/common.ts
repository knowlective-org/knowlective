// Words and messages used across screens.

export default {
  meta: {
    description: "A self-hosted tool for sharing documents and knowledge",
    titleSuffix: "{title} | KNOWLECTIVE",
  },
  duration: {
    minute: "{count, plural, one {# minute} other {# minutes}}",
    hour: "{count, plural, one {# hour} other {# hours}}",
    day: "{count, plural, one {# day} other {# days}}",
  },
  roles: {
    SITE_ADMIN: "Site admin",
    CONTENT_MANAGER: "Content manager",
    USER: "User",
  },
  access: {
    VIEW: "View",
    EDIT: "Edit",
    MANAGE: "Manage",
  },
  common: {
    email: "Email address",
    password: "Password",
    passwordWithMin: "Password (at least {min, number} characters)",
    confirmPassword: "Password (again)",
    displayName: "Display name",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    sending: "Sending…",
    none: "None",
    untitled: "Untitled",
    listSeparator: ", ",
    // Between two sentences shown together.
    sentenceSeparator: " ",
    errors: {
      invalidInput: "The input is invalid.",
      emailFormat: "The email address isn't valid.",
      passwordLength: "Passwords must be at least {min, number} characters.",
      passwordMismatch: "The passwords don't match.",
      mailFailed: "The email couldn't be sent. Please try again later.",
      mailNotConfigured: "Email sending isn't set up, so the reset email can't be sent. Please contact an administrator.",
      ssoOnly: "Logging in with a password is turned off. Please log in with single sign-on.",
      disabledAccount: "This account has been disabled. Please contact an administrator.",
      signupClosed: "Registration is closed at the moment.",
      domainNotAllowed: "Only email addresses on these domains can register: {domains}",
    },
    spamNote: "If the email doesn't arrive, check your spam folder too.",
  },
  publicUrl: {
    format: "The URL isn't valid (e.g. https://knowlective.example.com).",
    scheme: "Enter a URL starting with http:// or https://.",
    credentials: "The URL can't contain a user name or password.",
    path: "Enter a URL without a path or query (e.g. https://knowlective.example.com).",
  },
} as const;
