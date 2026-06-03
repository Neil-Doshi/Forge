const CACHE_PREFIX = "html-forge-shell";
const CACHE_VERSION = "v2";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(["./", "./index.html"])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/user-projects/") || url.pathname.includes("/api/")) return;

  const networkFirst = request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html") || url.pathname.includes("/assets/");
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);

      return networkFirst ? network : cached || network;
    })
  );
});
