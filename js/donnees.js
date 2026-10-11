// Données de l'app (favoris, morceaux masqués, volume, vue) et valeurs par défaut.

export const ARTISTE_INCONNU = 'Artiste inconnu';

const DEFAUT = { version: 1, favoris: [], masques: [], volume: 0.8, vue: 'tout' };

export async function lireDonnees(source) {
  const lu = (await source.readData()) || {};
  return {
    ...DEFAUT,
    ...lu,
    favoris: Array.isArray(lu.favoris) ? [...lu.favoris] : [],
    masques: Array.isArray(lu.masques) ? [...lu.masques] : [],
  };
}

// Nom du fichier sans dossier ni extension.
export function titreParDefaut(id) {
  return id.split('/').pop().replace(/\.[^.]+$/, '');
}

// Titre, artiste et durée d'un morceau. « lu » = [titre, artiste, durée] trouvés dans le fichier.
// Sans étiquette : on essaie « Artiste - Titre », sinon le nom du fichier seul.
export function decrire(id, lu) {
  let titre = lu && lu[0];
  let artiste = lu && lu[1];
  if (!titre) {
    const nom = titreParDefaut(id);
    const coupe = nom.match(/^(.+?)\s+[-–]\s+(.+)$/);
    if (!coupe) {
      titre = nom;
    } else {
      titre = coupe[2];
      if (!/^\d+$/.test(coupe[1])) artiste = artiste || coupe[1]; // « 01 - Titre » : pas un artiste
    }
  }
  return { titre, artiste: artiste || ARTISTE_INCONNU, duree: (lu && lu[2]) || 0 };
}
