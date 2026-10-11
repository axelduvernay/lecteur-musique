// Application : état, écran principal, écran « Choisir un morceau ».

import * as kv from './kv.js';
import { creerSource } from './source.js';
import { creerLecteur } from './lecteur.js';
import { lireTags } from './tags.js';
import { lireDonnees, titreParDefaut, ARTISTE_INCONNU } from './donnees.js';

const $ = (id) => document.getElementById(id);
const icone = (nom) => `<svg class="icone" aria-hidden="true"><use href="#i-${nom}"/></svg>`;
const normaliser = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const comparer = new Intl.Collator('fr', { sensitivity: 'base', numeric: true }).compare;

const source = creerSource();
const estIPad = source.type === 'ipad';

const pistes = new Map(); // id → { id, titre, artiste, cle }
let meta = {};            // id → [titre, artiste] déjà lus dans les fichiers
let donnees = { favoris: [], masques: [], volume: 0.8 };
let favoris = new Set();
let masques = new Set();
let mode = 'tout';        // 'tout' ou 'favoris'
let etat = 'attente';

const lecteur = creerLecteur({
  getFile: (id) => source.getFile(id),
  surPiste: majPiste,
  surEtat: majPause,
  surPanne,
});

// ───────────── Morceaux et données ─────────────

function appliquerMeta(p) {
  const m = meta[p.id];
  p.titre = (m && m[0]) || titreParDefaut(p.id);
  p.artiste = (m && m[1]) || ARTISTE_INCONNU;
  p.cle = normaliser(p.titre + ' ' + p.artiste);
}

const visibles = () => [...pistes.keys()].filter((id) => !masques.has(id));

function idsPortee() {
  const ids = visibles();
  if (mode === 'favoris') {
    const mesFavoris = ids.filter((id) => favoris.has(id));
    if (mesFavoris.length) return mesFavoris;
    mode = 'tout';
  }
  return ids;
}

let minuterie = 0;
let ecritures = Promise.resolve();

function sauver(delai = 0) {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => {
    donnees.favoris = [...favoris];
    donnees.masques = [...masques];
    ecritures = ecritures.then(() => source.writeData(donnees)).catch(() => {});
  }, delai);
}

async function charger() {
  if (etat !== 'lecture') definirEtat('attente');
  try {
    donnees = await lireDonnees(source);
    favoris = new Set(donnees.favoris);
    masques = new Set(donnees.masques);
    const ids = await source.listTracks();
    meta = (await kv.lire('meta').catch(() => null)) || {};
    pistes.clear();
    for (const id of ids) {
      const p = { id };
      appliquerMeta(p);
      pistes.set(id, p);
    }
    for (const id of Object.keys(meta)) if (!pistes.has(id)) delete meta[id];
  } catch {
    return definirEtat(estIPad ? 'vide' : 'installer');
  }
  $('volume').value = Math.round(donnees.volume * 100);
  appliquerVolume();
  lecteur.definirPortee(idsPortee());
  if (!visibles().length) definirEtat('vide');
  else definirEtat(lecteur.courant ? 'lecture' : 'pret');
  indexer();
}

// Lit titres et artistes en tâche de fond ; le résultat est gardé pour les lancements suivants.
let passe = 0;

async function lireMeta(p) {
  let tags;
  try {
    tags = await lireTags(await source.getFile(p.id));
  } catch {
    return;
  }
  meta[p.id] = [tags.titre, tags.artiste];
  appliquerMeta(p);
  majLigne(p);
  if (p.id === lecteur.courant) majPiste();
}

async function indexer() {
  const moi = ++passe;
  let lus = 0;
  for (const p of [...pistes.values()]) {
    if (moi !== passe) return;
    if (p.id in meta) continue;
    await lireMeta(p);
    if (++lus % 50 === 0) kv.ecrire('meta', meta).catch(() => {});
  }
  if (!lus) return;
  kv.ecrire('meta', meta).catch(() => {});
  if (!$('choisir').hidden) majArtistes();
}

// ───────────── Écran principal ─────────────

const ACTIONS = {
  pret: icone('lecture') + '<span>Écouter</span>',
  installer: '<span>Choisir le dossier de musique</span>',
  autoriser: '<span>Autoriser l’accès à ma musique</span>',
  vide: estIPad ? icone('plus') + '<span>Ajouter des morceaux</span>' : '',
};
const MESSAGES = {
  attente: 'Un instant…',
  installer: 'Pour commencer, choisissez le dossier où se trouve la musique.',
  vide: estIPad ? 'Aucun morceau pour le moment.' : 'Aucun morceau dans le dossier de musique.',
};

function definirEtat(nouvel, message) {
  etat = nouvel;
  $('principal').dataset.etat = etat;
  const texte = message || MESSAGES[etat] || '';
  $('message').textContent = texte;
  $('message').hidden = !texte;
  const bouton = $('btn-action');
  bouton.hidden = !ACTIONS[etat];
  bouton.innerHTML = ACTIONS[etat] || '';
  bouton.className = etat === 'pret' ? 'plein geant' : 'plein grand';
  $('btn-choisir').hidden = etat !== 'pret' && etat !== 'lecture';
  $('bandeau-favoris').hidden = mode !== 'favoris';
}

function majPiste() {
  const p = pistes.get(lecteur.courant);
  if (!p) return;
  $('titre').textContent = p.titre;
  $('artiste').textContent = p.artiste;
  majFavori();
  marquerActuel();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: p.titre,
      artist: p.artiste,
      artwork: [{ src: 'icons/icone-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
  if (!(p.id in meta)) lireMeta(p);
}

function majFavori() {
  const oui = favoris.has(lecteur.courant);
  const bouton = $('btn-favori');
  bouton.setAttribute('aria-pressed', oui);
  bouton.innerHTML = oui
    ? icone('coeur') + '<span>Dans mes favoris</span>'
    : icone('coeur-vide') + '<span>Ajouter aux favoris</span>';
}

function majPause() {
  const enPause = lecteur.enPause;
  $('btn-pause').innerHTML = enPause
    ? icone('lecture') + '<span>Reprendre</span>'
    : icone('pause') + '<span>Pause</span>';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = enPause ? 'paused' : 'playing';
}

function surPanne(type) {
  if (type === 'acces') return definirEtat('autoriser');
  if (!visibles().length) return definirEtat('vide');
  mode = 'tout';
  lecteur.definirPortee(idsPortee());
  definirEtat('pret', type === 'lecture' ? 'La musique n’a pas pu démarrer. Appuyez sur « Écouter » pour réessayer.' : '');
}

function ecouter(nouveauMode, premier) {
  mode = nouveauMode;
  lecteur.lancer(idsPortee(), premier);
  fermerChoisir();
  definirEtat('lecture');
}

function appliquerVolume() {
  const v = $('volume').value / 100;
  $('volume').style.setProperty('--niveau', `${v * 100}%`);
  lecteur.volume = v * v; // courbe douce : le bas du curseur reste utilisable
  return v;
}

$('btn-action').addEventListener('click', async () => {
  if (etat === 'pret') {
    ecouter('tout');
  } else if (etat === 'installer') {
    try {
      await source.choisirDossier();
    } catch {
      return; // choix annulé
    }
    await charger();
  } else if (etat === 'autoriser') {
    if (await source.autoriser().catch(() => false)) await charger();
  } else if (etat === 'vide') {
    $('import').click();
  }
});

$('btn-precedent').addEventListener('click', () => lecteur.precedent());
$('btn-suivant').addEventListener('click', () => lecteur.suivant());
$('btn-pause').addEventListener('click', () => lecteur.basculer());

$('btn-favori').addEventListener('click', () => {
  const id = lecteur.courant;
  if (!id) return;
  if (favoris.has(id)) favoris.delete(id);
  else favoris.add(id);
  sauver();
  majFavori();
  if (mode === 'favoris') {
    lecteur.definirPortee(idsPortee());
    $('bandeau-favoris').hidden = mode !== 'favoris';
  }
});

$('btn-tout').addEventListener('click', () => {
  mode = 'tout';
  lecteur.definirPortee(idsPortee());
  $('bandeau-favoris').hidden = true;
});

$('volume').addEventListener('input', () => {
  donnees.volume = appliquerVolume();
  sauver(600);
});

if (!lecteur.volumeReglable) $('zone-volume').hidden = true;

if ('mediaSession' in navigator) {
  const actions = {
    play: () => lecteur.reprendre(),
    pause: () => lecteur.pause(),
    previoustrack: () => lecteur.precedent(),
    nexttrack: () => lecteur.suivant(),
  };
  for (const [nom, action] of Object.entries(actions)) {
    try {
      navigator.mediaSession.setActionHandler(nom, action);
    } catch {
      // action inconnue de ce navigateur
    }
  }
}

// ───────────── Menu « Autres choix » : retirer un morceau ─────────────

let aRetirer = null;

$('btn-menu').addEventListener('click', () => {
  const p = pistes.get(lecteur.courant);
  if (!p) return;
  aRetirer = p.id;
  $('menu-titre').textContent = p.titre;
  $('menu-rappel').textContent = `« ${p.titre} » ne sera plus joué. Il n’est pas effacé de ${estIPad ? 'l’iPad' : 'l’ordinateur'}.`;
  $('menu-choix').hidden = false;
  $('menu-confirmer').hidden = true;
  $('menu').showModal();
});

$('menu-retirer').addEventListener('click', () => {
  $('menu-choix').hidden = true;
  $('menu-confirmer').hidden = false;
});
$('menu-fermer').addEventListener('click', () => $('menu').close());
$('menu-non').addEventListener('click', () => $('menu').close());

$('menu-oui').addEventListener('click', () => {
  $('menu').close();
  if (!aRetirer) return;
  masques.add(aRetirer);
  sauver();
  lecteur.definirPortee(idsPortee());
  if (lecteur.courant === aRetirer) lecteur.suivant();
});

// ───────────── Écran « Choisir un morceau » ─────────────

const LOT = 150;
const lignes = new Map(); // id → éléments de la ligne affichée
let resultat = [];
let affiches = 0;
let tri = 'titre';
let seulementFavoris = false;

function majArtistes() {
  const menu = $('filtre-artiste');
  const choisi = menu.value;
  const noms = new Set();
  for (const p of pistes.values()) if (!masques.has(p.id)) noms.add(p.artiste);
  const options = [...noms].sort(comparer).map((nom) => new Option(nom, nom));
  menu.replaceChildren(new Option('Tous les artistes', ''), ...options);
  menu.value = noms.has(choisi) ? choisi : '';
}

function filtrer() {
  const cherche = normaliser($('recherche').value.trim());
  const artiste = $('filtre-artiste').value;
  resultat = [...pistes.values()].filter((p) =>
    !masques.has(p.id)
    && (!seulementFavoris || favoris.has(p.id))
    && (!artiste || p.artiste === artiste)
    && (!cherche || p.cle.includes(cherche)));
  resultat.sort(tri === 'titre'
    ? (a, b) => comparer(a.titre, b.titre) || comparer(a.artiste, b.artiste)
    : (a, b) => comparer(a.artiste, b.artiste) || comparer(a.titre, b.titre));

  $('liste').replaceChildren();
  lignes.clear();
  affiches = 0;
  ajouterLignes();

  const aucunFavori = !visibles().some((id) => favoris.has(id));
  $('btn-ecouter-favoris').disabled = aucunFavori;
  $('liste-vide').hidden = resultat.length > 0;
  $('liste-vide').textContent = seulementFavoris && aucunFavori
    ? 'Aucun favori pour le moment. Pendant un morceau, appuyez sur « Ajouter aux favoris ».'
    : 'Aucun morceau trouvé.';
}

function ajouterLignes() {
  const fragment = document.createDocumentFragment();
  const fin = Math.min(affiches + LOT, resultat.length);
  for (; affiches < fin; affiches++) {
    const p = resultat[affiches];
    const li = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'morceau';
    bouton.dataset.id = p.id;
    const textes = document.createElement('span');
    textes.className = 'm-textes';
    const titre = document.createElement('span');
    titre.className = 'm-titre';
    titre.textContent = p.titre;
    const artiste = document.createElement('span');
    artiste.className = 'm-artiste';
    artiste.textContent = p.artiste;
    textes.append(titre, artiste);
    bouton.append(textes);
    if (favoris.has(p.id)) bouton.insertAdjacentHTML('beforeend', icone('coeur') + '<span class="m-note">Favori</span>');
    if (p.id === lecteur.courant) bouton.classList.add('actuel');
    li.append(bouton);
    fragment.append(li);
    lignes.set(p.id, { bouton, titre, artiste });
  }
  $('liste').append(fragment);
}

function majLigne(p) {
  const ligne = lignes.get(p.id);
  if (!ligne) return;
  ligne.titre.textContent = p.titre;
  ligne.artiste.textContent = p.artiste;
}

function marquerActuel() {
  for (const [id, ligne] of lignes) ligne.bouton.classList.toggle('actuel', id === lecteur.courant);
}

function ouvrirChoisir() {
  $('principal').hidden = true;
  $('choisir').hidden = false;
  majArtistes();
  filtrer();
  window.scrollTo(0, 0);
}

function fermerChoisir() {
  $('choisir').hidden = true;
  $('principal').hidden = false;
  window.scrollTo(0, 0);
}

$('btn-choisir').addEventListener('click', ouvrirChoisir);
$('btn-retour').addEventListener('click', fermerChoisir);

let frappe = 0;
$('recherche').addEventListener('input', () => {
  clearTimeout(frappe);
  frappe = setTimeout(filtrer, 200);
});
$('filtre-artiste').addEventListener('change', filtrer);

for (const bouton of document.querySelectorAll('[data-tri]')) {
  bouton.addEventListener('click', () => {
    tri = bouton.dataset.tri;
    for (const b of document.querySelectorAll('[data-tri]')) b.setAttribute('aria-pressed', b === bouton);
    filtrer();
  });
}

$('filtre-favoris').addEventListener('click', () => {
  seulementFavoris = !seulementFavoris;
  $('filtre-favoris').setAttribute('aria-pressed', seulementFavoris);
  filtrer();
});

$('btn-ecouter-favoris').addEventListener('click', () => ecouter('favoris'));

$('liste').addEventListener('click', (e) => {
  const bouton = e.target.closest('button[data-id]');
  if (!bouton) return;
  const id = bouton.dataset.id;
  ecouter(mode === 'favoris' && favoris.has(id) ? 'favoris' : 'tout', id);
});

new IntersectionObserver((entrees) => {
  if (entrees.some((e) => e.isIntersecting) && affiches < resultat.length) ajouterLignes();
}, { rootMargin: '800px' }).observe($('sentinelle'));

// ───────────── iPad : ajouter des morceaux ─────────────

$('btn-ajouter').hidden = !estIPad;
$('btn-ajouter').addEventListener('click', () => $('import').click());

$('import').addEventListener('change', async () => {
  const choisis = [...$('import').files];
  $('import').value = '';
  if (!choisis.length || !source.addFiles) return;
  const avancement = $('avancement');
  avancement.hidden = false;
  await source.addFiles(choisis, (i, total) => {
    avancement.textContent = `Ajout des morceaux… ${i} sur ${total}`;
  });
  avancement.hidden = true;
  await charger();
  if (!$('choisir').hidden) {
    majArtistes();
    filtrer();
  }
});

// ───────────── Démarrage ─────────────

// La page admin prévient quand elle a changé quelque chose : on repart à zéro.
if ('BroadcastChannel' in window) new BroadcastChannel('lecteur').onmessage = () => location.reload();

// Pas de service worker en développement local, pour toujours voir les fichiers à jour.
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

majPause();
majFavori();

(async () => {
  let depart;
  try {
    depart = await source.init();
  } catch {
    depart = estIPad ? 'vide' : 'installer';
  }
  if (depart === 'pret') await charger();
  else definirEtat(depart);
})();
