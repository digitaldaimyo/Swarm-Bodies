// Web Push handlers, imported into the generated service worker (SPEC §9.4). Paths are
// relative to the worker's scope, so this works at "/" and under a base path (GitHub Pages).
const scoped = (path) => new URL(path, self.registration.scope).href;
self.addEventListener("push", (event) => {
  let data = { title: "Swarm Bodies", body: "Your turn", gameId: "" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // Not JSON: keep the defaults.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: scoped("icons/icon-192.png"),
      badge: scoped("icons/icon-192.png"),
      tag: `turn-${data.gameId}`,
      data: { url: scoped(data.gameId ? `?game=${data.gameId}` : "") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || scoped("");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
