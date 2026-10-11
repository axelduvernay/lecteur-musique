// Moteur de lecture : un seul élément <audio>, aléatoire « en sac », historique.

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

function melanger(t) {
  // Fisher-Yates
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}

// surPiste(id | null) : le morceau en cours a changé · surEtat() : lecture/pause a changé
// surTemps(position, duree) : la position a avancé
// surPanne('acces' | 'lecture') : la lecture s'est arrêtée toute seule
export function creerLecteur({ getFile, surPiste, surEtat, surTemps, surPanne }) {
  const audio = new Audio();
  audio.preload = 'auto';

  let ordre = [];         // morceaux jouables, dans l'ordre affiché
  let portee = new Set(); // les mêmes, pour les tests rapides
  let aleatoire = true;
  let sac = [];           // reste du tour aléatoire, déjà mélangé (on prend à la fin)
  let historique = [];
  let curseur = -1;       // position dans l'historique
  let courant = null;
  let url = '';
  let jeton = 0;          // annule un chargement quand on change de morceau entre-temps
  let echecs = 0;
  let deverrouille = false;

  const enCours = () => url !== '' && audio.src === url;

  function noter(id) {
    historique.push(id);
    if (historique.length > HISTORIQUE_MAX) historique.shift();
    curseur = historique.length - 1;
    return id;
  }

  // Prochain morceau hors historique. Aléatoire : pas de répétition avant la fin du tour.
  function nouveau(consommer) {
    if (!ordre.length) return null;
    if (!aleatoire) return ordre[(ordre.indexOf(courant) + 1) % ordre.length];
    if (!sac.length) {
      sac = melanger([...ordre]);
      // Nouveau tour : ne pas rejouer tout de suite le morceau qui vient de passer.
      const dernier = sac.length - 1;
      if (dernier > 0 && sac[dernier] === courant) [sac[0], sac[dernier]] = [sac[dernier], sac[0]];
    }
    return consommer ? sac.pop() : sac[sac.length - 1];
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
    set volume(v) { audio.volume = Math.min(1, Math.max(0, v)); },

    get aleatoire() { return aleatoire; },
    set aleatoire(oui) {
      aleatoire = !!oui;
      sac = aleatoire ? melanger(ordre.filter((id) => id !== courant)) : [];
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
      if (premier == null) {
        sac = [];
        suivant();
      } else {
        sac = aleatoire ? melanger(ordre.filter((id) => id !== premier)) : [];
        lire(noter(premier));
      }
    },

    // La liste des morceaux jouables a changé (favori, tri, morceau ajouté).
    definirPortee(ids) {
      const avant = portee;
      ordre = [...ids];
      portee = new Set(ordre);
      sac = sac.filter((id) => portee.has(id));
      if (sac.length) {
        for (const id of ordre) {
          if (!avant.has(id) && id !== courant) sac.splice(Math.floor(Math.random() * (sac.length + 1)), 0, id);
        }
      }
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
