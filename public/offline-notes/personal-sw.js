const notesPath = "/offline-notes/personal";
const cacheName = "taskboard-offline-personal-notes-v1";

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function staticAsset(value) {
  const url = new URL(value, self.location.origin);
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "prepare" || !event.ports[0]
    || !event.source || new URL(event.source.url).pathname !== notesPath) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      const urls = new Set([notesPath, ...event.data.assets.filter(staticAsset)]);
      // Store only the shell and public build assets. Cache.addAll commits the
      // batch together, so an incomplete download cannot replace a ready shell.
      await cache.addAll([...urls].map((url) => new Request(url, { cache: "reload", redirect: "error" })));
      port.postMessage("ready");
    } catch {
      port.postMessage("failed");
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === notesPath && !url.searchParams.has("sign-in")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { redirect: "manual", signal: AbortSignal.timeout(3500) });
        if (response.type !== "opaqueredirect" && response.status !== 401 && response.status !== 403)
          return response;
        return (await caches.match(notesPath, { cacheName })) ?? response;
      } catch {
        return (await caches.match(notesPath, { cacheName })) ?? Response.error();
      }
    })());
  } else if (staticAsset(request.url)) {
    event.respondWith(caches.match(request, { cacheName }).then((cached) => cached ?? fetch(request)));
  }
});
