// ─────────────────────────────────────────────────────────────────────────
// Service worker di Meteo Trek — pattern meteo-rotta: cache-first SOLO
// per l'app shell (asset locali + Leaflet da CDN), con nome cache
// versionato DA BUMPARE A OGNI DEPLOY. Le chiamate alle API meteo e ai
// tile della mappa NON passano MAI dalla cache: devono essere fresche.
// ─────────────────────────────────────────────────────────────────────────

const CACHE = 'meteo-trek-v11';

const CDN_LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';

const ASSETS = [
  './',
  './index.html',
  './css/stile.css',
  './js/app.js',
  './js/config.js',
  './js/storage.js',
  './js/tempo.js',
  './js/geo.js',
  './js/gpx.js',
  './js/percorso.js',
  './js/eta.js',
  './js/percepita.js',
  './js/utci-poly.js',
  './js/radiante.js',
  './js/windchill.js',
  './js/dispersione.js',
  './js/nuvole.js',
  './js/marcia.js',
  './js/sole.js',
  './js/copertura.js',
  './dati/copertura-vodafone.json',
  './js/rischio.js',
  './js/affidabilita.js',
  './js/api/meteo.js',
  './js/api/modelli.js',
  './js/api/ensemble.js',
  './js/api/komoot.js',
  './js/api/outdooractive.js',
  './js/api/areeprotette.js',
  './dati/parchi-cani.json',
  './js/ui/mappa.js',
  './js/ui/tabella.js',
  './js/ui/marcia.js',
  './js/ui/profilo.js',
  './js/ui/impostazioni.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  CDN_LEAFLET + 'leaflet.css',
  CDN_LEAFLET + 'leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // CacheStorage è partizionato per ORIGIN, non per scope: su
  // dancat90.github.io convivono anche meteo-rotta e sleep-countdown.
  // La pulizia deve toccare SOLO le cache col nostro prefisso, altrimenti
  // spazza l'offline delle altre PWA (e loro il nostro).
  e.waitUntil(
    caches.keys().then((chiavi) =>
      Promise.all(
        chiavi
          .filter((k) => k.startsWith('meteo-trek-') && k !== CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  const eShell =
    new URL(url).origin === self.location.origin || url.startsWith(CDN_LEAFLET);
  // API esterne (Open-Meteo, Komoot, Outdooractive, tile mappa): rete pura
  if (!eShell) return;
  e.respondWith(
    caches.match(e.request).then(
      (inCache) =>
        inCache ||
        fetch(e.request).catch(() =>
          // Offline su una navigazione: torna alla shell
          e.request.mode === 'navigate' ? caches.match('./index.html') : undefined
        )
    )
  );
});
