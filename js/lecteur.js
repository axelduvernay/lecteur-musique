// Moteur de lecture : un seul élément <audio>, ordre toujours aléatoire, historique.

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

// surPiste(id) : un morceau commence · surEtat() : lecture/pause a changé
// surPanne('acces' | 'lecture' | 'vide') : la lecture s'est arrêtée toute seule
export function creerLecteur({ getFile, surPiste, surEtat, surPanne }) {
  const audio = new Audio();
  audio.preload = 'auto';

  let portee = new Set(); // morceaux qui peuvent être joués
  let aVenir = [];        // reste du tour en cours, déjà mélangé (on prend à la fin)
  let historique = [];
  let curseur = -1;       // position dans l'historique
  let courant = null;
  let url = '';
  let jeton = 0;          // annule un chargement quand on change de morceau entre-temps
  let echecs = 0;
  let deverrouille = false;

  function noter(id) {
    historique.push(id);
    if (historique.length > HISTORIQUE_MAX) historique.shift();
    curseur = historique.length - 1;
    return id;
  }

  function tirer() {
    if (curseur < historique.length - 1) return historique[++curseur];
    if (!aVenir.length) {
      aVenir = melanger([...portee]);
      // Nouveau tour : ne pas rejouer tout de suite le morceau qui vient de passer.
      const dernier = aVenir.length - 1;
      if (dernier > 0 && aVenir[dernier] === courant) [aVenir[0], aVenir[dernier]] = [aVenir[dernier], aVenir[0]];
    }
    return aVenir.length ? noter(aVenir.pop()) : null;
  }

  function arreter() {
    jeton++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    courant = null;
    surPanne('vide');
  }

  function suivant() {
    for (let essais = historique.length + portee.size + 1; essais > 0; essais--) {
      const id = tirer();
      if (id === null) break;
      if (portee.has(id)) return lire(id);
    }
    arreter();
  }

  function precedent() {
    let c = curseur - 1;
    while (c >= 0 && !portee.has(historique[c])) c--;
    if (c < 0) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
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
      audio.pause();
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
        audio.pause();
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

  audio.addEventListener('ended', () => { if (audio.src === url) suivant(); });
  audio.addEventListener('error', () => { if (url && audio.src === url) echec(); });
  audio.addEventListener('playing', () => { if (audio.src === url) echecs = 0; surEtat(); });
  audio.addEventListener('play', surEtat);
  audio.addEventListener('pause', surEtat);

  return {
    get courant() { return courant; },
    get enPause() { return audio.paused; },
    set volume(v) { audio.volume = Math.min(1, Math.max(0, v)); },

    // Sur iPad et iPhone le volume ne se règle qu'avec les boutons de l'appareil.
    volumeReglable: (() => {
      const essai = new Audio();
      try { essai.volume = 0.5; } catch { return false; }
      return essai.volume === 0.5;
    })(),

    // Nouvelle lecture aléatoire, en commençant éventuellement par un morceau précis.
    lancer(ids, premier) {
      deverrouiller();
      portee = new Set(ids);
      curseur = historique.length - 1;
      if (premier == null) {
        aVenir = [];
        suivant();
      } else {
        aVenir = melanger([...portee]).filter((id) => id !== premier);
        lire(noter(premier));
      }
    },

    // La liste des morceaux jouables a changé (favori, morceau retiré, morceau ajouté).
    definirPortee(ids) {
      const nouvelle = new Set(ids);
      aVenir = aVenir.filter((id) => nouvelle.has(id));
      if (aVenir.length) {
        for (const id of nouvelle) {
          if (!portee.has(id) && id !== courant) aVenir.splice(Math.floor(Math.random() * (aVenir.length + 1)), 0, id);
        }
      }
      portee = nouvelle;
    },

    suivant,
    precedent,
    reprendre() { audio.play().catch(() => {}); },
    pause() { audio.pause(); },
    basculer() { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); },
  };
}
