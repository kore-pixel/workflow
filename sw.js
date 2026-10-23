// 오프라인에서도 열리게 하는 간단한 서비스 워커 (네트워크 우선, 실패하면 저장본)
const CACHE = 'planner-v1';
const CORE = [
  './', 'index.html', 'styles.css', 'fonts.css', 'config.js', 'core.js', 'sync.js', 'app.js',
  'vendor/msal-browser.min.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Microsoft 로그인/Graph 등 외부 요청은 건드리지 않음 (폰트 CSS/파일만 저장본 허용)
  const isFont = /jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
