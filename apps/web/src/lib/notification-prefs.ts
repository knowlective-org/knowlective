// A person's notification settings (User.notificationPrefs): which events
// they're told about, and whether desktop notifications show the details
// (who, which page, an excerpt) or only the kind of event. Shared by the
// account screen, its Server Action and the notifier (server/notifications.ts)
// — keep dependency-free.

export const NOTIFICATION_KINDS = ["CHAT_MESSAGE", "TODO_ASSIGNED", "TODO_OVERDUE", "PAGE_CHANGED", "MENTION"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationPrefs = {
  // Off: no notifications at all (the choices below are kept for when it's on).
  enabled: boolean;
  // Off: not notified of that kind at all (neither in the app nor on the desktop).
  kinds: Record<NotificationKind, boolean>;
  // Desktop notifications: who / which page / an excerpt, or only the kind.
  pushDetails: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  kinds: { CHAT_MESSAGE: true, TODO_ASSIGNED: true, TODO_OVERDUE: true, PAGE_CHANGED: true, MENTION: true },
  pushDetails: true,
};

// The stored value (anything) as settings: what's missing or malformed is
// the default.
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  const value = raw && typeof raw === "object" ? (raw as { enabled?: unknown; kinds?: unknown; pushDetails?: unknown }) : {};
  const stored = value.kinds && typeof value.kinds === "object" ? (value.kinds as Record<string, unknown>) : {};
  const kinds = { ...DEFAULT_NOTIFICATION_PREFS.kinds };
  for (const kind of NOTIFICATION_KINDS) if (typeof stored[kind] === "boolean") kinds[kind] = stored[kind];
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_NOTIFICATION_PREFS.enabled,
    kinds,
    pushDetails: typeof value.pushDetails === "boolean" ? value.pushDetails : DEFAULT_NOTIFICATION_PREFS.pushDetails,
  };
}

// Whether someone with these settings is told of `kind`.
export function wantsNotification(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  return prefs.enabled && prefs.kinds[kind];
}
