// Retirement script for browsers still running the old cached application.
// The SPA does not register a service worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("8mb-")) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      }))
        if (client.url.startsWith(self.registration.scope))
          await client.navigate(client.url);
    })(),
  ),
);
