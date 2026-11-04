// Desktop notifications (Web Push): registered from the account screen
// (app/(app)/account/notification-section.tsx) for the whole site. The server
// (server/notifications.ts) sends { title, body, url, tag }; `url` is relative
// to this worker's scope, which includes the base path.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not ours: nothing to show.
  }
  if (!data.title) return;
  event.waitUntil(
    self.registration.showNotification(String(data.title), {
      body: String(data.body || ""),
      tag: data.tag ? String(data.tag) : undefined,
      data: { url: String(data.url || "") },
    }),
  );
});

// A click opens (or focuses) the page it's about.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const target = new URL(event.notification.data?.url || "", scope);
  // Only within the site.
  const url = target.href.startsWith(scope) ? target.href : scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
