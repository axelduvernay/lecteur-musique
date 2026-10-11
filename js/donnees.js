// Données de l'app (favoris, morceaux masqués, volume) et valeurs par défaut.

export const ARTISTE_INCONNU = 'Artiste inconnu';

const DEFAUT = { version: 1, favoris: [], masques: [], volume: 0.8 };

export async function lireDonnees(source) {
  const lu = (await source.readData()) || {};
  return {
    ...DEFAUT,
    ...lu,
    favoris: Array.isArray(lu.favoris) ? [...lu.favoris] : [],
    masques: Array.isArray(lu.masques) ? [...lu.masques] : [],
  };
}

// Sans étiquette : le titre est le nom du fichier sans son extension.
export function titreParDefaut(id) {
  return id.split('/').pop().replace(/\.[^.]+$/, '');
}
