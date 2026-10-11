// Source « iPad » : Safari ne sait pas ouvrir un dossier. Les morceaux choisis sont
// copiés dans le stockage privé du navigateur (OPFS), les données de l'app aussi.

import { AUDIO } from './source-pc.js';

const DOSSIER = 'musique';
const FICHIER_DONNEES = 'lecteur-data.json';
const EXTENSIONS = {
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/m4a': '.m4a',
  'audio/aac': '.aac', 'audio/aacp': '.aac',
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
};
const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' };

let ouvrier;
let numero = 0;
const attentes = new Map();

// Anciens Safari : l'écriture dans l'OPFS n'existe que dans un worker.
function ecrireParOuvrier(chemin, nom, blob) {
  if (!ouvrier) {
    ouvrier = new Worker(new URL('./opfs-worker.js', import.meta.url));
    ouvrier.onmessage = ({ data }) => {
      const attente = attentes.get(data.id);
      attentes.delete(data.id);
      if (data.ok) attente.ok();
      else attente.ko(new Error(data.message));
    };
  }
  return new Promise((ok, ko) => {
    attentes.set(++numero, { ok, ko });
    ouvrier.postMessage({ id: numero, chemin, nom, blob });
  });
}

async function ecrire(chemin, nom, blob) {
  let repertoire = await navigator.storage.getDirectory();
  for (const partie of chemin) repertoire = await repertoire.getDirectoryHandle(partie, { create: true });
  const poignee = await repertoire.getFileHandle(nom, { create: true });
  if (!poignee.createWritable) return ecrireParOuvrier(chemin, nom, blob);
  const flux = await poignee.createWritable();
  await flux.write(blob);
  await flux.close();
}

export function creerSourceIPad() {
  const racine = () => navigator.storage.getDirectory();
  const musique = async () => (await racine()).getDirectoryHandle(DOSSIER, { create: true });

  function nomStocke(fichier) {
    let nom = (fichier.name || '').replace(/[/\\]/g, '-').trim();
    if (!AUDIO.test(nom)) {
      const extension = EXTENSIONS[fichier.type];
      if (!extension) return null;
      nom = (nom || 'morceau') + extension;
    }
    return nom;
  }

  // Même nom et même taille : c'est le même morceau, on le remplace. Sinon on numérote.
  async function nomLibre(repertoire, nom, taille) {
    const point = nom.lastIndexOf('.');
    for (let n = 1; ; n++) {
      const essai = n === 1 ? nom : `${nom.slice(0, point)} (${n})${nom.slice(point)}`;
      try {
        const existant = await (await repertoire.getFileHandle(essai)).getFile();
        if (existant.size === taille) return essai;
      } catch {
        return essai;
      }
    }
  }

  return {
    type: 'ipad',

    async init() {
      await racine();
      navigator.storage.persist?.();
      return 'pret';
    },

    async listTracks() {
      const noms = [];
      for await (const [nom, element] of (await musique()).entries()) {
        if (element.kind === 'file' && AUDIO.test(nom)) noms.push(nom);
      }
      return noms;
    },

    async getFile(id) {
      const fichier = await (await (await musique()).getFileHandle(id)).getFile();
      if (fichier.type) return fichier;
      return fichier.slice(0, fichier.size, TYPES[id.split('.').pop().toLowerCase()] || '');
    },

    async readData() {
      try {
        return JSON.parse(await (await (await (await racine()).getFileHandle(FICHIER_DONNEES)).getFile()).text());
      } catch {
        return null;
      }
    },

    async writeData(data) {
      await ecrire([], FICHIER_DONNEES, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    },

    // Copie les fichiers choisis ; renvoie le nombre de morceaux ajoutés.
    async addFiles(liste, surProgres) {
      navigator.storage.persist?.();
      const repertoire = await musique();
      let ajoutes = 0;
      for (let i = 0; i < liste.length; i++) {
        surProgres?.(i + 1, liste.length);
        const nom = nomStocke(liste[i]);
        if (!nom) continue;
        try {
          await ecrire([DOSSIER], await nomLibre(repertoire, nom, liste[i].size), liste[i]);
          ajoutes++;
        } catch {
          // Fichier illisible ou stockage plein : on passe au suivant.
        }
      }
      return ajoutes;
    },
  };
}
