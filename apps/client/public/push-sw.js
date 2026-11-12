// Web Push handlers, imported into the generated service worker (SPEC §9.4).
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
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: `turn-${data.gameId}`,
      data: { url: data.gameId ? `/?game=${data.gameId}` : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
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
