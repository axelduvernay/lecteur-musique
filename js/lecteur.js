// Moteur de lecture : un seul élément <audio>, aléatoire sans répétition, historique.

// Silence très court : joué au premier clic, il autorise Safari à enchaîner les morceaux.
const SILENCE = (() => {
  const n = 400;
  const o = new Uint8Array(44 + n).fill(0x80, 44);
  const v = new DataView(o.buffer);
  const texte = (pos, s) => { for (let i = 0; i < s.length; i++) o[pos + i] = s.charCodeAt(i); };
  texte(0, 'RIFF'); v.setUint32(4, 36 + n, true); texte(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  texte(36, 'data'); v.setUint32(40, n, true);
  return URL.createObjectURL(new Blob([o], { type: 'audio/wav' }));
})();

const HISTORIQUE_MAX = 500;
const ECHECS_MAX = 25;
const RECENTS_MAX = 60;

// surPiste(id | null) : le morceau en cours a changé · surEtat() : lecture/pause a changé
// surTemps(position, duree) : la position a avancé
// surPanne('acces' | 'lecture') : la lecture s'est arrêtée toute seule
// gainPour(id) : volume propre au morceau, de 0 à 1 (égalisation des niveaux)
// surTour() : la mémoire de l'aléatoire a changé (à enregistrer)
export function creerLecteur({ getFile, gainPour, surPiste, surEtat, surTemps, surPanne, surTour }) {
  const audio = new Audio();
  audio.preload = 'auto';

  let ordre = [];         // morceaux jouables, dans l'ordre affiché
  let portee = new Set(); // les mêmes, pour les tests rapides
  let aleatoire = true;
  let joues = new Set();  // déjà passés dans le tour en cours ; gardé d'un lancement à l'autre
  let recents = [];       // derniers morceaux joués, du plus ancien au plus récent
  let annonce = null;     // prochain morceau déjà tiré (c'est lui qu'affiche « Ensuite »)
  let historique = [];
  let curseur = -1;       // position dans l'historique
  let courant = null;
  let url = '';
  let jeton = 0;          // annule un chargement quand on change de morceau entre-temps
  let echecs = 0;
  let deverrouille = false;
  let volume = 1;         // réglage de l'utilisateur
  let gain = 1;           // correction du morceau en cours, jamais au-dessus de 1
  let rampe = 0;

  const appliquerVolume = () => { audio.volume = Math.min(1, Math.max(0, volume * gain)); };

  // En cours de morceau, la correction arrive en douceur pour ne pas s'entendre.
  function fixerGain(cible, doucement) {
    clearInterval(rampe);
    cible = Math.min(1, Math.max(0.05, cible || 1));
    if (!doucement || audio.paused) {
      gain = cible;
      return appliquerVolume();
    }
    const depart = gain;
    const debut = performance.now();
    rampe = setInterval(() => {
      const t = Math.min(1, (performance.now() - debut) / 1800);
      gain = depart + (cible - depart) * t;
      appliquerVolume();
      if (t === 1) clearInterval(rampe);
    }, 40);
  }

  const enCours = () => url !== '' && audio.src === url;

  function noter(id) {
    historique.push(id);
    if (historique.length > HISTORIQUE_MAX) historique.shift();
    curseur = historique.length - 1;
    joues.add(id);
    recents.push(id);
    if (recents.length > RECENTS_MAX) recents.shift();
    if (surTour) surTour();
    return id;
  }

  // Tire au hasard parmi les morceaux pas encore passés. Quand tout est passé, un nouveau
  // tour commence, mais sans les derniers morceaux entendus : ils attendront le tour d'après.
  function tirer() {
    const libres = () => ordre.filter((id) => !joues.has(id) && id !== courant);
    let restants = libres();
    if (!restants.length) {
      const nombre = Math.min(25, Math.floor(ordre.length / 3));
      const gardes = new Set(nombre ? recents.slice(-nombre) : []);
      for (const id of ordre) if (!gardes.has(id)) joues.delete(id);
      restants = libres();
      if (!restants.length) restants = ordre.filter((id) => id !== courant);
      if (!restants.length) restants = ordre; // un seul morceau
    }
    return restants[Math.floor(Math.random() * restants.length)];
  }

  // Prochain morceau hors historique.
  function nouveau(consommer) {
    if (!ordre.length) return null;
    if (!aleatoire) return ordre[(ordre.indexOf(courant) + 1) % ordre.length];
    if (annonce === null || !portee.has(annonce) || joues.has(annonce) || annonce === courant) annonce = tirer();
    const id = annonce;
    if (consommer) annonce = null;
    return id;
  }

  // Le morceau qui suivra, sans rien changer.
  function apercu() {
    for (let c = curseur + 1; c < historique.length; c++) if (portee.has(historique[c])) return historique[c];
    return nouveau(false);
  }

  function arreter() {
    jeton++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (url) URL.revokeObjectURL(url);
    url = '';
    courant = null;
    surPiste(null);
    surEtat();
  }

  function suivant() {
    while (curseur < historique.length - 1) {
      const id = historique[++curseur];
      if (portee.has(id)) return lire(id);
    }
    const id = nouveau(true);
    if (id === null) return arreter();
    lire(noter(id));
  }

  function precedent() {
    let c = curseur - 1;
    while (c >= 0 && !portee.has(historique[c])) c--;
    if (c < 0 || (enCours() && audio.currentTime > 3)) {
      if (enCours()) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }
    curseur = c;
    lire(historique[c]);
  }

  // Morceau illisible : on passe au suivant sans rien dire.
  function echec() {
    echecs++;
    if (echecs > Math.min(portee.size, ECHECS_MAX)) {
      echecs = 0;
      arreter();
      return surPanne('lecture');
    }
    suivant();
  }

  async function lire(id) {
    const j = ++jeton;
    courant = id;
    surPiste(id);
    let fichier;
    try {
      fichier = await getFile(id);
    } catch (e) {
      if (j !== jeton) return;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        arreter();
        return surPanne('acces');
      }
      return echec();
    }
    if (j !== jeton) return;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(fichier);
    fixerGain(gainPour(id), false);
    audio.src = url;
    audio.play().catch(() => {}); // un fichier illisible déclenche l'événement « error »
    surEtat();
  }

  function deverrouiller() {
    if (deverrouille) return;
    deverrouille = true;
    audio.src = SILENCE;
    audio.play().catch(() => {});
  }

  const temps = () => { if (enCours()) surTemps(audio.currentTime, audio.duration); };
  for (const nom of ['timeupdate', 'durationchange', 'seeked']) audio.addEventListener(nom, temps);
  audio.addEventListener('ended', () => { if (enCours()) suivant(); });
  audio.addEventListener('error', () => { if (enCours()) echec(); });
  audio.addEventListener('playing', () => { if (enCours()) echecs = 0; surEtat(); });
  audio.addEventListener('play', () => surEtat());
  audio.addEventListener('pause', () => surEtat());

  return {
    get courant() { return courant; },
    get enPause() { return audio.paused; },
    get duree() { return enCours() && Number.isFinite(audio.duration) ? audio.duration : 0; },
    set volume(v) { volume = v; appliquerVolume(); },
    get gain() { return gain; },
    // Le niveau du morceau vient d'être mesuré : on l'applique s'il joue encore.
    ajusterGain(id, valeur) { if (id === courant) fixerGain(valeur, true); },

    get aleatoire() { return aleatoire; },
    set aleatoire(oui) {
      aleatoire = !!oui;
      annonce = null;
      historique.length = curseur + 1; // ce qui suit est recalculé
    },

    // Sur iPad et iPhone le volume ne se règle qu'avec les boutons de l'appareil.
    volumeReglable: (() => {
      const essai = new Audio();
      try { essai.volume = 0.5; } catch { return false; }
      return essai.volume === 0.5;
    })(),

    // Nouvelle lecture sur cette liste, en commençant éventuellement par un morceau précis.
    lancer(ids, premier) {
      deverrouiller();
      ordre = [...ids];
      portee = new Set(ordre);
      historique.length = curseur + 1;
      if (premier == null) suivant();
      else lire(noter(premier));
    },

    // La liste des morceaux jouables a changé (favori, tri, morceau ajouté).
    definirPortee(ids) {
      ordre = [...ids];
      portee = new Set(ordre);
    },

    // Mémoire de l'aléatoire, à enregistrer et à redonner au lancement suivant.
    get tour() { return { joues: [...joues], recents: [...recents] }; },
    restaurerTour(tour) {
      joues = new Set(tour && Array.isArray(tour.joues) ? tour.joues : []);
      recents = tour && Array.isArray(tour.recents) ? tour.recents.slice(-RECENTS_MAX) : [];
      annonce = null;
    },

    apercu,
    suivant,
    precedent,
    arreter,
    reprendre() { if (enCours()) audio.play().catch(() => {}); },
    pause() { audio.pause(); },
    basculer() { if (!enCours()) return; if (audio.paused) audio.play().catch(() => {}); else audio.pause(); },
    chercher(ratio) { if (this.duree) audio.currentTime = Math.min(1, Math.max(0, ratio)) * this.duree; },
    avancer(secondes) { if (this.duree) audio.currentTime = Math.min(this.duree, Math.max(0, audio.currentTime + secondes)); },
  };
}
