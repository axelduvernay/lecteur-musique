// Source « PC » : Chrome, accès direct au dossier de musique (File System Access API).

import * as kv from './kv.js';

export const AUDIO = /\.(mp3|m4a|aac|wav)$/i;
const FICHIER_DONNEES = '.lecteur-data.json';
const DROITS = { mode: 'readwrite' };

export function creerSourcePC() {
  let dossier = null;
  const fichiers = new Map(); // chemin relatif → FileSystemFileHandle

  async function parcourir(repertoire, prefixe) {
    for await (const [nom, element] of repertoire.entries()) {
      if (nom.startsWith('.')) continue;
      if (element.kind === 'directory') {
        try {
          await parcourir(element, prefixe + nom + '/');
        } catch {
          // Sous-dossier illisible : on l'ignore.
        }
      } else if (AUDIO.test(nom)) {
        fichiers.set(prefixe + nom, element);
      }
    }
  }

  return {
    type: 'pc',

    // 'installer' (aucun dossier choisi), 'autoriser' (permission à redonner) ou 'pret'.
    async init() {
      dossier = await kv.lire('dossier');
      if (!dossier) return 'installer';
      return (await dossier.queryPermission(DROITS)) === 'granted' ? 'pret' : 'autoriser';
    },

    get nomDossier() {
      return dossier ? dossier.name : '';
    },

    async choisirDossier() {
      dossier = await window.showDirectoryPicker({ id: 'musique', mode: 'readwrite', startIn: 'music' });
      await kv.ecrire('dossier', dossier);
      await kv.effacer('meta');
    },

    async autoriser() {
      return (await dossier.requestPermission(DROITS)) === 'granted';
    },

    async listTracks() {
      fichiers.clear();
      await parcourir(dossier, '');
      return [...fichiers.keys()];
    },

    async getFile(id) {
      return fichiers.get(id).getFile();
    },

    async readData() {
      let texte;
      try {
        texte = await (await (await dossier.getFileHandle(FICHIER_DONNEES)).getFile()).text();
      } catch (e) {
        if (e.name === 'NotFoundError') return null;
        throw e;
      }
      try {
        return JSON.parse(texte);
      } catch {
        return null;
      }
    },

    async writeData(data) {
      const poignee = await dossier.getFileHandle(FICHIER_DONNEES, { create: true });
      const flux = await poignee.createWritable();
      await flux.write(JSON.stringify(data, null, 1));
      await flux.close();
    },
  };
}
