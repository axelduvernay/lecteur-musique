// Petit stockage clé → valeur dans IndexedDB (dossier choisi, titres déjà lus).

const BASE = 'lecteur';
const MAGASIN = 'kv';
let ouverture;

function ouvrir() {
  ouverture ??= new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
    // Une base bloquée ne répond jamais : mieux vaut renoncer que rester sur « Un instant… ».
    setTimeout(() => ko(new Error('base indisponible')), 4000);
  }).catch((e) => {
    ouverture = undefined;
    throw e;
  });
  return ouverture;
}

async function requete(mode, action) {
  const base = await ouvrir();
  return new Promise((ok, ko) => {
    const r = action(base.transaction(MAGASIN, mode).objectStore(MAGASIN));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

export const lire = (cle) => requete('readonly', (m) => m.get(cle));
export const ecrire = (cle, valeur) => requete('readwrite', (m) => m.put(valeur, cle));
export const effacer = (cle) => requete('readwrite', (m) => m.delete(cle));
