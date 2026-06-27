const CACHE = "tracker-v8";
const ASSETS = [
  ".",
  "index.html",
  "styles.css?v=20260627-3",
  "src/app.js?v=20260627-3",
  "src/logic.js",
  "src/storage.js",
  "src/charts.js",
  "src/sync.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Network-first для своих файлов: когда есть сеть — всегда свежее (без залипания
// на старой версии), кэш обновляется попутно и служит запасным для офлайна.
// Чужие origin (наш API на blitsplus.ru и т.п.) не трогаем — пропускаем как есть.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
