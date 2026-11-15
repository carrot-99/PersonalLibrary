// ======================================================
// sw.js（Service Worker）
// 所持確認ページ（index.html・lookup.js・アイコン）を端末に保存し、回線がなくても・遅くてもすぐ開けるようにする。
// 保存してある分をすぐ返し、裏で取り直して次に開くときに新しくする（stale-while-revalidate）。
// ページを変えたら CACHE_NAME の版を上げる（古い保存は activate で消す）
// 蔵書のデータはここではなく、ページが localStorage に保存する（lookup.js）
// ======================================================
const CACHE_NAME = 'ninjin-lookup-v1';
const ASSETS = [
  './',
  './index.html',
  './lookup.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // ページを開くとき（?launch=1 付きなど）は、クエリを無視して保存してあるページを返す
  const isPage = request.mode === 'navigate';
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(isPage ? './' : request, { ignoreSearch: true }).then(cached => {
        const network = fetch(request)
          .then(response => {
            // リダイレクトされた応答はページとして返せない（Safari で表示できなくなる）ので保存しない
            if(response && response.ok && !response.redirected) cache.put(isPage ? './' : request, response.clone());
            return response;
          });
        if(cached){
          event.waitUntil(network.catch(() => {}));
          return cached;
        }
        return network;
      })
    )
  );
});
