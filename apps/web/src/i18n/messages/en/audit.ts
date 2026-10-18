// Audit log entries (lib/audit.ts), written in the site's default language
// when the change is made.

export default {
  audit: {
    passwordReset: "{who} reset their password ({via, select, admin {link issued by an administrator} other {emailed link}})",
    oidcUserCreated: "Created the account for {email} with single sign-on ({role})",
  },
} as const;
