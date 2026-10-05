/* 电闯关·电工大作战 — Service Worker（网页应用可安装/离线壳缓存） */
const CACHE = 'dg-app-v1';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/api.js',
  './js/ui.js',
  './js/exam.js',
  './js/game.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(CORE);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (u.pathname.indexOf('/api/') >= 0) { return; } /* API 一律走网络，不缓存数据 */
  if (e.request.method !== 'GET') { return; }
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) { return hit; }
      return fetch(e.request).then(function (res) {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
