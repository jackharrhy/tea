// Remove the service worker installed by earlier builds. New visits register none.
export async function clearLegacyCache() {
  try {
    const script = new URL(`${import.meta.env.BASE_URL}sw.js`, location.origin)
      .href;
    const controlled =
      navigator.serviceWorker?.controller?.scriptURL === script;
    const registrations =
      (await navigator.serviceWorker?.getRegistrations()) ?? [];
    for (const registration of registrations) {
      if (
        [
          registration.active,
          registration.waiting,
          registration.installing,
        ].some((worker) => worker?.scriptURL === script)
      )
        await registration.unregister();
    }
    if ("caches" in window) {
      for (const name of await caches.keys())
        if (name.startsWith("8mb-")) await caches.delete(name);
    }
    if (controlled) location.reload();
  } catch {
    /* Storage can be disabled. The SPA does not depend on it. */
  }
}
