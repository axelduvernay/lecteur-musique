// Service worker : garde les fichiers de l'app pour un lancement rapide, même sans réseau.
// À CHAQUE MISE EN LIGNE : augmenter le numéro de VERSION, sinon la mise à jour n'arrive pas.

const VERSION = 'lecteur-v4';

const FICHIERS = [
  './',
  'index.html',
  'admin.html',
  'style.css',
  'manifest.json',
  'js/app.js',
  'js/admin.js',
  'js/donnees.js',
  'js/kv.js',
  'js/lecteur.js',
  'js/niveau.js',
  'js/opfs-worker.js',
  'js/source.js',
  'js/source-pc.js',
  'js/source-ipad.js',
  'js/tags.js',
  'fonts/inter.woff2',
  'fonts/newsreader.woff2',
  'fonts/newsreader-italique.woff2',
  'icons/icone-180.png',
  'icons/icone-192.png',
  'icons/icone-512.png',
  'icons/icone-masque-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((reponse) => reponse || fetch(e.request)),
  );
});
