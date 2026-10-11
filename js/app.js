// Application : état, bibliothèque (vues, recherche, tri, liste) et lecteur.

import * as kv from './kv.js';
import { creerSource } from './source.js';
import { creerLecteur } from './lecteur.js';
import { lireTags } from './tags.js';
import { mesurerNiveau } from './niveau.js';
import { lireDonnees, decrire } from './donnees.js';

const PRENOM = 'Rico';

const $ = (id) => document.getElementById(id);
const app = $('app');
const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
const normaliser = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const comparer = new Intl.Collator('fr', { sensitivity: 'base', numeric: true }).compare;

const COEUR = '<svg viewBox="0 0 24 24" class="trait" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 5 6.6 5c2 0 3.5 1.1 5.4 3.2C13.9 6.1 15.4 5 17.4 5c3.2 0 5.1 3.2 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>';

const source = creerSource();
const estIPad = source.type === 'ipad';

const pistes = new Map(); // id → { id, titre, artiste, duree, cle }
let meta = {};            // id → [titre, artiste, durée, niveau sonore] lus dans les fichiers
let donnees = { favoris: [], masques: [], volume: 0.8, vue: 'tout' };
let favoris = new Set();
let masques = new Set();
let etat = 'attente';
let vue = 'tout';         // vue affichée : 'tout' ou 'favoris'
let vueJouee = 'tout';    // vue d'où la lecture a été lancée
let tri = 'titre';

const lecteur = creerLecteur({
  getFile: (id) => source.getFile(id),
  gainPour: (id) => gainDe(meta[id] && meta[id][3]),
  surPiste: majPiste,
  surEtat: majLecture,
  surTemps: majTemps,
  surPanne,
});

// ───────────── Morceaux et données ─────────────

function appliquerMeta(p) {
  Object.assign(p, decrire(p.id, meta[p.id]));
  p.cle = normaliser(p.titre + ' ' + p.artiste);
}

const ordres = {
  titre: (a, b) => comparer(a.titre, b.titre) || comparer(a.artiste, b.artiste),
  artiste: (a, b) => comparer(a.artiste, b.artiste) || comparer(a.titre, b.titre),
};

// Morceaux d'une vue, dans l'ordre du tri.
function pistesVue(laquelle) {
  const liste = [];
  for (const p of pistes.values()) {
    if (!masques.has(p.id) && (laquelle === 'tout' || favoris.has(p.id))) liste.push(p);
  }
  return liste.sort(ordres[tri]);
}

// Ce que le lecteur a le droit de jouer : la vue d'où la lecture est partie.
function idsJouables() {
  let liste = pistesVue(vueJouee);
  if (!liste.length && vueJouee === 'favoris') {
    vueJouee = 'tout';
    liste = pistesVue('tout');
  }
  return liste.map((p) => p.id);
}

let minuterie = 0;
let ecritures = Promise.resolve();

function sauver(delai = 0) {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => {
    donnees.favoris = [...favoris];
    donnees.masques = [...masques];
    donnees.vue = vue;
    ecritures = ecritures.then(() => source.writeData(donnees)).catch(() => {});
  }, delai);
}

let sauvegardeMeta = 0;
function sauverMeta() {
  clearTimeout(sauvegardeMeta);
  sauvegardeMeta = setTimeout(() => kv.ecrire('meta', meta).catch(() => {}), 800);
}

async function charger() {
  if (etat !== 'pret') definirEtat('attente');
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

  vue = donnees.vue === 'favoris' ? 'favoris' : 'tout';
  $('volume').value = Math.round(donnees.volume * 100);
  appliquerVolume();
  if (lecteur.courant && !pistes.has(lecteur.courant)) lecteur.arreter();
  lecteur.definirPortee(idsJouables());

  definirEtat(pistesVue('tout').length ? 'pret' : 'vide');
  choisirVue(vue, false);
  majPiste(lecteur.courant);
  indexer();
}

// Lit titres, artistes et durées en tâche de fond ; le résultat est gardé pour les lancements suivants.
let passe = 0;
const estLu = (id) => Array.isArray(meta[id]) && meta[id].length >= 3;

async function lireMeta(p) {
  let tags;
  try {
    tags = await lireTags(await source.getFile(p.id));
  } catch {
    return;
  }
  // La durée mesurée pendant la lecture est plus fiable que celle estimée.
  const connue = estLu(p.id) ? meta[p.id][2] : 0;
  const niveau = estLu(p.id) ? meta[p.id][3] : undefined;
  meta[p.id] = [tags.titre, tags.artiste, connue || tags.duree];
  if (niveau !== undefined) meta[p.id][3] = niveau;
  appliquerMeta(p);
  majLigne(p);
  if (p.id === lecteur.courant) majPiste(p.id);
}

async function indexer() {
  const moi = ++passe;
  let lus = 0;
  for (const p of [...pistes.values()]) {
    if (moi !== passe) return;
    if (estLu(p.id)) continue;
    await lireMeta(p);
    if (++lus % 40 === 0) {
      sauverMeta();
      majCompte();
    }
  }
  if (!lus) return;
  sauverMeta();
  majCompte();
  majEnsuite();
}

// ───────────── Égalisation des niveaux ─────────────
// Chaque morceau est mesuré une fois (juste avant ou pendant sa première écoute). Ceux qui
// dépassent le niveau visé sont baissés d'autant ; les autres ne sont jamais amplifiés.

const NIVEAU_VISE = -16;    // LUFS
const BAISSE_MAX = 12;      // dB
const DUREE_MAX = 15 * 60;  // au-delà, le morceau n'est pas mesuré (trop lourd à décoder)

function gainDe(niveau) {
  if (typeof niveau !== 'number') return 1;
  return 10 ** (Math.max(-BAISSE_MAX, Math.min(0, NIVEAU_VISE - niveau)) / 20);
}

let mesures = Promise.resolve();

function preparerNiveau(id) {
  if (!lecteur.volumeReglable) return; // iPad : une page ne peut pas régler le volume
  mesures = mesures.then(async () => {
    const p = pistes.get(id);
    // Morceaux sautés entre-temps : inutile de les mesurer maintenant.
    if (!p || (id !== lecteur.courant && id !== lecteur.apercu())) return;
    if (!estLu(id)) await lireMeta(p);
    if (!estLu(id) || meta[id][3] !== undefined) return;
    let niveau = null;
    try {
      if (!(p.duree > DUREE_MAX)) niveau = await mesurerNiveau(await source.getFile(id));
    } catch {
      // fichier illisible : pas de correction
    }
    if (!estLu(id)) return;
    meta[id][3] = niveau;
    sauverMeta();
    lecteur.ajusterGain(id, gainDe(niveau));
  }).catch(() => {});
}

// ───────────── États : chargement, premier lancement, permission, vide ─────────────

const ACCUEILS = {
  installer: {
    titre: 'Où se trouve votre musique ?',
    texte: 'Choisissez le dossier qui contient vos morceaux. C’est à faire une seule fois.',
    action: 'Choisir le dossier',
  },
  autoriser: {
    titre: 'Votre musique vous attend',
    texte: 'Un clic suffit pour retrouver tous vos morceaux.',
    action: 'Autoriser l’accès à ma musique',
  },
  vide: estIPad
    ? { titre: 'Ajoutez votre musique', texte: 'Choisissez les morceaux à écouter sur cet appareil.', action: 'Ajouter des morceaux' }
    : { titre: 'Aucun morceau dans ce dossier', texte: 'Ajoutez-y de la musique, ou choisissez un autre dossier.', action: 'Choisir un autre dossier' },
};

function definirEtat(nouvel) {
  etat = nouvel;
  app.dataset.etat = etat;
  const accueil = ACCUEILS[etat];
  if (!accueil) return;
  $('accueil-titre').textContent = accueil.titre;
  $('accueil-texte').textContent = accueil.texte;
  $('accueil-action').textContent = accueil.action;
}

async function definirDossier() {
  if (estIPad) return $('import').click();
  try {
    await source.choisirDossier();
  } catch {
    return; // choix annulé
  }
  await charger();
}

$('btn-dossier-texte').textContent = estIPad ? 'Ajouter des morceaux' : 'Définir le dossier';
$('btn-dossier').addEventListener('click', definirDossier);

$('accueil-action').addEventListener('click', async () => {
  if (etat === 'autoriser') {
    if (await source.autoriser().catch(() => false)) await charger();
  } else {
    await definirDossier();
  }
});

function surPanne(type) {
  if (type === 'acces') return definirEtat('autoriser');
  $('titre').textContent = 'Lecture impossible';
  $('artiste').textContent = 'Ces morceaux ne peuvent pas être lus.';
}

// ───────────── Message d'accueil (machine à écrire) ─────────────

function saluer() {
  const heure = new Date().getHours();
  const moment = heure >= 5 && heure < 12 ? 'ce matin' : heure >= 12 && heure < 18 ? 'cet après-midi' : 'ce soir';
  const debut = `Salut ${PRENOM} ! `;
  const suite = `On écoute quoi ${moment} ?`;
  const total = debut + suite;

  $('salut-lu').textContent = total;
  const italique = document.createElement('em');
  italique.textContent = suite;
  $('salut-place').append(debut, italique);

  const romain = document.createTextNode('');
  const penche = document.createElement('em');
  const caret = document.createElement('span');
  caret.className = 'caret';
  $('salut-frappe').append(romain, penche, caret);

  const ecrire = (n) => {
    romain.data = debut.slice(0, n);
    penche.textContent = suite.slice(0, Math.max(0, n - debut.length));
  };
  if (calme) {
    caret.remove();
    return ecrire(total.length);
  }
  let n = 0;
  const pas = () => {
    ecrire(++n);
    if (n < total.length) setTimeout(pas, total[n - 1] === '!' ? 480 : 36 + Math.random() * 48);
    else setTimeout(() => caret.classList.add('fini'), 2400);
  };
  setTimeout(pas, 650);
}

// ───────────── Glissières (vues et tri) ─────────────

function placer(conteneur, anime = true) {
  const actif = conteneur.querySelector('[aria-pressed="true"]');
  const curseur = conteneur.querySelector('.curseur');
  if (!actif || !actif.offsetWidth) return;
  if (!anime) conteneur.classList.remove('prete');
  curseur.style.transform = `translate(${actif.offsetLeft}px, ${actif.offsetTop}px)`;
  curseur.style.width = `${actif.offsetWidth}px`;
  curseur.style.height = `${actif.offsetHeight}px`;
  if (!conteneur.classList.contains('prete')) {
    curseur.getBoundingClientRect(); // applique la position avant d'activer la transition
    conteneur.classList.add('prete');
  }
}

function activer(conteneur, bouton, anime) {
  for (const b of conteneur.querySelectorAll('button')) b.setAttribute('aria-pressed', b === bouton);
  placer(conteneur, anime);
}

const replacer = () => {
  placer($('vues'), false);
  placer($('tri'), false);
};
addEventListener('resize', replacer);
document.fonts?.ready.then(replacer);

function rejouer(element, classe) {
  element.classList.remove(classe);
  element.getBoundingClientRect();
  element.classList.add(classe);
}

// ───────────── Vues, compteurs, liste ─────────────

const LOT = 120;
const lignes = new Map(); // id → éléments de la ligne affichée
let resultat = [];
let affiches = 0;

const indicateur = document.createElement('span');
indicateur.className = 'indic';
indicateur.innerHTML = '<span class="eq"><i></i><i></i><i></i></span>'
  + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

function duree(secondes) {
  if (!secondes) return '';
  const s = Math.round(secondes);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const reste = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${reste}` : `${m}:${reste}`;
}

function majCompteurs() {
  let total = 0;
  let aimes = 0;
  for (const id of pistes.keys()) {
    if (masques.has(id)) continue;
    total++;
    if (favoris.has(id)) aimes++;
  }
  $('n-tout').textContent = total.toLocaleString('fr-FR');
  $('n-favoris').textContent = aimes.toLocaleString('fr-FR');
}

function majCompte() {
  const liste = pistesVue(vue);
  const n = liste.length;
  let texte = `${n.toLocaleString('fr-FR')} ${n > 1 ? 'morceaux' : 'morceau'}`;
  if (n && liste.every((p) => p.duree)) {
    const minutes = Math.round(liste.reduce((somme, p) => somme + p.duree, 0) / 60);
    texte += minutes < 60 ? `, ${minutes} min` : `, ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  $('vue-compte').textContent = texte;
}

function choisirVue(nouvelle, anime = true) {
  vue = nouvelle;
  activer($('vues'), $('vues').querySelector(`[data-vue="${vue}"]`), anime);
  $('vue-titre').textContent = vue === 'favoris' ? 'Favoris' : 'Tous les morceaux';
  if (anime) rejouer($('tete-textes'), 'change');
  placer($('tri'), false);
  majCompteurs();
  majCompte();
  afficherListe(true);
}

function afficherListe(anime) {
  const cherche = normaliser($('recherche').value.trim());
  const toutes = pistesVue(vue);
  resultat = cherche ? toutes.filter((p) => p.cle.includes(cherche)) : toutes;

  $('liste').replaceChildren();
  lignes.clear();
  affiches = 0;
  $('defilant').scrollTop = 0;
  ajouterLignes(anime && !calme);

  const vide = $('liste-vide');
  vide.hidden = resultat.length > 0;
  if (!resultat.length) {
    vide.textContent = toutes.length
      ? `Aucun morceau ne correspond à « ${$('recherche').value.trim()} ».`
      : 'Aucun favori pour l’instant. Touchez le cœur à côté d’un morceau pour l’ajouter ici.';
  }
}

function ajouterLignes(anime) {
  const fragment = document.createDocumentFragment();
  const debut = affiches;
  const fin = Math.min(affiches + LOT, resultat.length);
  for (; affiches < fin; affiches++) {
    const p = resultat[affiches];
    const li = document.createElement('li');
    li.className = 'rangee';
    li.dataset.id = p.id;
    if (anime && affiches - debut < 18) {
      li.classList.add('entree');
      li.style.setProperty('--i', affiches - debut);
    }

    const morceau = document.createElement('button');
    morceau.type = 'button';
    morceau.className = 'morceau';
    const cases = ['m-etat', 'm-titre', 'm-artiste', 'm-duree'].map((classe) => {
      const span = document.createElement('span');
      span.className = classe;
      return span;
    });
    morceau.append(...cases);

    const coeur = document.createElement('button');
    coeur.type = 'button';
    coeur.className = 'coeur';
    coeur.innerHTML = COEUR;

    li.append(morceau, coeur);
    fragment.append(li);
    const ligne = { li, morceau, coeur, etat: cases[0], titre: cases[1], artiste: cases[2], duree: cases[3] };
    lignes.set(p.id, ligne);
    remplirLigne(ligne, p);
  }
  $('liste').append(fragment);
  marquerActuel();
}

function remplirLigne(ligne, p) {
  ligne.titre.textContent = p.titre;
  ligne.artiste.textContent = p.artiste;
  ligne.duree.textContent = duree(p.duree);
  ligne.morceau.setAttribute('aria-label', `Écouter : ${p.titre}, ${p.artiste}`);
  const aime = favoris.has(p.id);
  ligne.coeur.setAttribute('aria-pressed', aime);
  ligne.coeur.setAttribute('aria-label', `${aime ? 'Retirer des favoris' : 'Ajouter aux favoris'} : ${p.titre}`);
}

function majLigne(p) {
  const ligne = lignes.get(p.id);
  if (ligne) remplirLigne(ligne, p);
}

function marquerActuel() {
  indicateur.remove();
  for (const [id, ligne] of lignes) {
    const actuelle = id === lecteur.courant;
    ligne.li.classList.toggle('actuelle', actuelle);
    if (actuelle) ligne.etat.append(indicateur);
  }
}

for (const bouton of $('vues').querySelectorAll('button')) {
  bouton.addEventListener('click', () => {
    if (bouton.dataset.vue === vue) return;
    choisirVue(bouton.dataset.vue);
    sauver(400);
  });
}

for (const bouton of $('tri').querySelectorAll('button')) {
  bouton.addEventListener('click', () => {
    if (bouton.dataset.tri === tri) return;
    tri = bouton.dataset.tri;
    activer($('tri'), bouton);
    lecteur.definirPortee(idsJouables());
    afficherListe(true);
    majEnsuite();
  });
}

let frappe = 0;
$('recherche').addEventListener('input', () => {
  clearTimeout(frappe);
  frappe = setTimeout(() => afficherListe(false), 140);
});

new IntersectionObserver((entrees) => {
  if (entrees.some((e) => e.isIntersecting) && affiches < resultat.length) ajouterLignes(false);
}, { root: $('defilant'), rootMargin: '900px' }).observe($('sentinelle'));

$('liste').addEventListener('click', (e) => {
  const rangee = e.target.closest('.rangee');
  if (!rangee) return;
  const id = rangee.dataset.id;
  if (e.target.closest('.coeur')) return basculerFavori(id);
  if (id === lecteur.courant) return lecteur.basculer();
  ecouter(id);
});

// ───────────── Favoris ─────────────

function basculerFavori(id) {
  if (!id || !pistes.has(id)) return;
  const aime = !favoris.has(id);
  if (aime) favoris.add(id);
  else favoris.delete(id);
  sauver();
  majCompteurs();

  const ligne = lignes.get(id);
  if (ligne) {
    remplirLigne(ligne, pistes.get(id));
    if (aime) rejouer(ligne.coeur, 'bat');
  }
  if (id === lecteur.courant) {
    majFavori();
    if (aime) rejouer($('btn-favori'), 'bat');
  }
  if (vueJouee === 'favoris') {
    lecteur.definirPortee(idsJouables());
    majEnsuite();
  }
  if (vue === 'favoris') {
    majCompte();
    if (!aime && ligne) retirerLigne(id, ligne);
  }
}

// Dans la vue Favoris, le morceau retiré s'efface en douceur.
function retirerLigne(id, ligne) {
  lignes.delete(id);
  resultat = resultat.filter((p) => p.id !== id);
  affiches = Math.max(0, affiches - 1);
  const fin = () => {
    ligne.li.remove();
    if (!resultat.length) afficherListe(false);
  };
  if (calme) return fin();
  ligne.li.style.overflow = 'hidden';
  ligne.li.animate(
    [{ height: `${ligne.li.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
    { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  ).onfinish = fin;
}

function majFavori() {
  const aime = favoris.has(lecteur.courant);
  $('btn-favori').setAttribute('aria-pressed', aime);
  $('btn-favori').setAttribute('aria-label', aime ? 'Retirer des favoris' : 'Ajouter aux favoris');
}

$('btn-favori').addEventListener('click', () => basculerFavori(lecteur.courant));

// ───────────── Lecteur ─────────────

// Lance la lecture sur la vue affichée, en commençant éventuellement par un morceau précis.
function ecouter(premier) {
  vueJouee = vue;
  const ids = idsJouables();
  if (ids.length) lecteur.lancer(ids, premier);
}

function majPiste(id) {
  const p = pistes.get(id);
  $('titre').textContent = p ? p.titre : 'Prêt à écouter';
  $('artiste').textContent = p ? p.artiste : 'Appuyez sur lecture';
  if (id !== majPiste.dernier) {
    majPiste.dernier = id;
    rejouer($('infos'), 'change');
    majTemps(0, p ? p.duree : 0, true);
    if (p) preparerNiveau(id);
  }
  majFavori();
  marquerActuel();
  majEnsuite();
  if (!p) return;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: p.titre,
      artist: p.artiste,
      artwork: [{ src: 'icons/icone-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
  if (!estLu(p.id)) lireMeta(p);
}

function majEnsuite() {
  const p = lecteur.courant ? pistes.get(lecteur.apercu()) : null;
  const ligne = $('ensuite');
  const texte = p ? `${p.titre} · ${p.artiste}` : '';
  if (ligne.dataset.texte === texte) return;
  ligne.dataset.texte = texte;
  ligne.replaceChildren();
  if (!p) return;
  preparerNiveau(p.id); // prêt avant que le morceau commence
  const titre = document.createElement('b');
  titre.textContent = p.titre;
  ligne.append('Ensuite : ', titre, ` · ${p.artiste}`);
  rejouer(ligne, 'change');
}

// Le vinyle prend et perd sa vitesse en douceur.
const rotation = calme ? null : $('disque').animate(
  [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
  { duration: 5200, iterations: Infinity },
);
rotation?.pause();
let vitesse = 0;
let cible = 0;
let elan = 0;

function tourner(oui) {
  if (!rotation) return;
  cible = oui ? 1 : 0;
  if (elan) return;
  const pas = () => {
    vitesse += (cible - vitesse) * 0.07;
    if (Math.abs(cible - vitesse) < 0.01) vitesse = cible;
    if (vitesse === 0) {
      rotation.pause();
    } else {
      rotation.playbackRate = vitesse;
      if (rotation.playState !== 'running') rotation.play();
    }
    elan = vitesse === cible ? 0 : requestAnimationFrame(pas);
  };
  elan = requestAnimationFrame(pas);
}

function majLecture() {
  const joue = !!lecteur.courant && !lecteur.enPause;
  app.dataset.lecture = joue ? 'joue' : lecteur.courant ? 'pause' : 'arret';
  $('btn-lecture').setAttribute('aria-label', joue ? 'Pause' : 'Lecture');
  tourner(joue);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = joue ? 'playing' : 'paused';
}

let glisse = false;

function peindreTemps(position, total, net) {
  const barre = $('barre');
  const part = total ? Math.min(1, position / total) : 0;
  barre.classList.toggle('net', !!net);
  $('barre-pleine').style.setProperty('--part', part);
  barre.setAttribute('aria-valuenow', Math.round(part * 100));
  $('t-ecoule').textContent = duree(position) || '0:00';
  $('t-reste').textContent = total ? `-${duree(Math.max(0, total - position)) || '0:00'}` : '';
}

function majTemps(position, total, net) {
  const p = pistes.get(lecteur.courant);
  const connu = Number.isFinite(total) && total > 0 ? total : p ? p.duree : 0;
  if (!glisse) peindreTemps(position, connu, net);
  // La durée réelle, connue pendant la lecture, corrige celle estimée à partir du fichier.
  if (p && Number.isFinite(total) && total > 0 && Math.abs(total - p.duree) > 1 && estLu(p.id)) {
    meta[p.id][2] = total;
    appliquerMeta(p);
    majLigne(p);
    majCompte();
    sauverMeta();
  }
}

function appliquerVolume() {
  const v = $('volume').value / 100;
  $('volume').style.setProperty('--niveau', `${v * 100}%`);
  lecteur.volume = v * v; // courbe douce : le bas du curseur reste utilisable
  return v;
}

function lectureOuPause() {
  if (lecteur.courant) lecteur.basculer();
  else ecouter();
}

$('btn-lecture').addEventListener('click', lectureOuPause);
$('btn-precedent').addEventListener('click', () => lecteur.precedent());
$('btn-suivant').addEventListener('click', () => (lecteur.courant ? lecteur.suivant() : ecouter()));

$('btn-aleatoire').addEventListener('click', () => {
  lecteur.aleatoire = true;
  $('btn-melange').setAttribute('aria-pressed', true);
  vueJouee = vue;
  const ids = idsJouables();
  if (ids.length) lecteur.lancer(ids);
});

$('btn-melange').addEventListener('click', () => {
  lecteur.aleatoire = !lecteur.aleatoire;
  $('btn-melange').setAttribute('aria-pressed', lecteur.aleatoire);
  majEnsuite();
});

$('volume').addEventListener('input', () => {
  donnees.volume = appliquerVolume();
  sauver(600);
});
if (!lecteur.volumeReglable) $('zone-volume').hidden = true;

// Barre de progression : un clic ou un glissement déplace la lecture.
const barre = $('barre');
const partPointee = (e) => {
  const cadre = barre.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - cadre.left) / cadre.width));
};
barre.addEventListener('pointerdown', (e) => {
  if (!lecteur.duree) return;
  glisse = true;
  barre.setPointerCapture(e.pointerId);
  barre.classList.add('glisse');
  peindreTemps(partPointee(e) * lecteur.duree, lecteur.duree, true);
});
barre.addEventListener('pointermove', (e) => {
  if (glisse) peindreTemps(partPointee(e) * lecteur.duree, lecteur.duree, true);
});
for (const nom of ['pointerup', 'pointercancel']) {
  barre.addEventListener(nom, (e) => {
    if (!glisse) return;
    glisse = false;
    barre.classList.remove('glisse');
    if (nom === 'pointerup') lecteur.chercher(partPointee(e));
  });
}
barre.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') lecteur.avancer(5);
  else if (e.key === 'ArrowLeft') lecteur.avancer(-5);
});

// Barre d'espace : lecture / pause, sauf pendant une saisie.
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || etat !== 'pret') return;
  if (e.target.closest('input, button, select, textarea')) return;
  e.preventDefault();
  lectureOuPause();
});

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

// ───────────── iPad : ajouter des morceaux ─────────────

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
});

// ───────────── Démarrage ─────────────

// La page admin prévient quand elle a changé quelque chose : on repart à zéro.
if ('BroadcastChannel' in window) new BroadcastChannel('lecteur').onmessage = () => location.reload();

// Pas de service worker en développement local, pour toujours voir les fichiers à jour.
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

saluer();
majPiste(null);
majLecture();

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
