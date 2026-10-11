// Lecture du titre et de l'artiste dans un fichier audio :
// ID3v2 (2.2, 2.3, 2.4), ID3v1 et MP4 (.m4a). Aucune dépendance.

const BLOC = 16384;

// Lit le fichier par fenêtres : les étiquettes sont au début, inutile de tout charger.
function lecteurFichier(fichier) {
  let debut = 0;
  let tampon = new Uint8Array(0);
  return {
    async octets(pos, n) {
      if (pos < debut || pos + n > debut + tampon.length) {
        debut = pos;
        tampon = new Uint8Array(await fichier.slice(pos, pos + Math.max(n, BLOC)).arrayBuffer());
      }
      return tampon.subarray(pos - debut, pos - debut + n);
    },
  };
}

function lecteurMemoire(tampon) {
  return { async octets(pos, n) { return tampon.subarray(pos, pos + n); } };
}

const u32 = (o, i) => ((o[i] << 24) | (o[i + 1] << 16) | (o[i + 2] << 8) | o[i + 3]) >>> 0;
const synchsafe = (o, i) => (o[i] << 21) | (o[i + 1] << 14) | (o[i + 2] << 7) | o[i + 3];
const ascii = (o, i, j) => String.fromCharCode(...o.subarray(i, j));
const decoder = (encodage, o) => new TextDecoder(encodage).decode(o);
const propre = (s) => s.replace(/﻿/g, '').replace(/\0+$/, '').replace(/\0/g, ' / ').trim();

function texteID3(o) {
  if (!o.length) return '';
  const corps = o.subarray(1);
  switch (o[0]) {
    case 1:
      if (corps[0] === 0xfe && corps[1] === 0xff) return propre(decoder('utf-16be', corps.subarray(2)));
      return propre(decoder('utf-16le', corps));
    case 2: return propre(decoder('utf-16be', corps));
    case 3: return propre(decoder('utf-8', corps));
    default: return propre(decoder('windows-1252', corps));
  }
}

const CADRES = { TIT2: 'titre', TPE1: 'artiste', TT2: 'titre', TP1: 'artiste' };

// Renvoie null si le fichier ne commence pas par une étiquette ID3v2.
async function id3v2(fichier) {
  let source = lecteurFichier(fichier);
  const tete = await source.octets(0, 10);
  if (tete.length < 10 || ascii(tete, 0, 3) !== 'ID3') return null;
  const version = tete[3];
  const drapeaux = tete[5];
  if (version < 2 || version > 4) return {};
  let pos = 10;
  let fin = 10 + synchsafe(tete, 6);

  if (drapeaux & 0x80 && version < 4) {
    // Étiquette « désynchronisée » (vieux logiciels) : on retire les octets ajoutés.
    const brut = new Uint8Array(await fichier.slice(10, Math.min(fin, 10 + 1048576)).arrayBuffer());
    const net = new Uint8Array(brut.length);
    let n = 0;
    for (let i = 0; i < brut.length; i++) {
      net[n++] = brut[i];
      if (brut[i] === 0xff && brut[i + 1] === 0) i++;
    }
    source = lecteurMemoire(net.subarray(0, n));
    pos = 0;
    fin = n;
  }

  if (drapeaux & 0x40) {
    if (version === 2) return {};
    const etendu = await source.octets(pos, 4);
    if (etendu.length < 4) return {};
    pos += version === 4 ? synchsafe(etendu, 0) : u32(etendu, 0) + 4;
  }

  const entete = version === 2 ? 6 : 10;
  const trouve = {};
  while (pos + entete <= fin && !(trouve.titre && trouve.artiste)) {
    const t = await source.octets(pos, entete);
    if (t.length < entete || t[0] === 0) break;
    const id = ascii(t, 0, version === 2 ? 3 : 4);
    const taille = version === 2 ? (t[3] << 16) | (t[4] << 8) | t[5]
      : version === 4 ? synchsafe(t, 4) : u32(t, 4);
    pos += entete;
    if (taille <= 0 || pos + taille > fin) break;
    const champ = CADRES[id];
    if (champ && taille <= 4096 && !trouve[champ]) trouve[champ] = texteID3(await source.octets(pos, taille));
    pos += taille;
  }
  return trouve;
}

async function id3v1(fichier) {
  if (fichier.size < 128) return {};
  const o = new Uint8Array(await fichier.slice(fichier.size - 128).arrayBuffer());
  if (ascii(o, 0, 3) !== 'TAG') return {};
  const champ = (i, j) => propre(decoder('windows-1252', o.subarray(i, j)).replace(/\0[\s\S]*$/, ''));
  return { titre: champ(3, 33), artiste: champ(33, 63) };
}

// Renvoie null si le fichier n'est pas un MP4.
async function mp4(fichier) {
  const source = lecteurFichier(fichier);
  const tete = await source.octets(0, 12);
  if (tete.length < 12 || ascii(tete, 4, 8) !== 'ftyp') return null;

  async function* boites(debut, fin) {
    let pos = debut;
    while (pos + 8 <= fin) {
      const t = await source.octets(pos, 16);
      if (t.length < 8) return;
      let taille = u32(t, 0);
      let entete = 8;
      if (taille === 1) {
        if (t.length < 16) return;
        taille = u32(t, 8) * 2 ** 32 + u32(t, 12);
        entete = 16;
      } else if (taille === 0) {
        taille = fin - pos;
      }
      if (taille < entete) return;
      yield { nom: ascii(t, 4, 8), debut: pos + entete, fin: Math.min(pos + taille, fin) };
      pos += taille;
    }
  }

  async function trouver(debut, fin, nom) {
    for await (const b of boites(debut, fin)) if (b.nom === nom) return b;
    return null;
  }

  let boite = { debut: 0, fin: fichier.size };
  for (const nom of ['moov', 'udta', 'meta', 'ilst']) {
    boite = await trouver(boite.debut, boite.fin, nom);
    if (!boite) return {};
    if (nom === 'meta') {
      const d = await source.octets(boite.debut, 8);
      if (d.length === 8 && ascii(d, 4, 8) !== 'hdlr') boite.debut += 4;
    }
  }

  const trouve = {};
  for await (const element of boites(boite.debut, boite.fin)) {
    const champ = element.nom === '©nam' ? 'titre' : element.nom === '©ART' ? 'artiste' : null;
    if (!champ) continue;
    const data = await trouver(element.debut, element.fin, 'data');
    const longueur = data ? data.fin - data.debut - 8 : 0;
    if (longueur > 0 && longueur <= 4096) {
      trouve[champ] = propre(decoder('utf-8', await source.octets(data.debut + 8, longueur)));
    }
  }
  return trouve;
}

// Renvoie toujours { titre, artiste } ; chaîne vide quand l'information manque.
export async function lireTags(fichier) {
  let t = {};
  try {
    t = (await id3v2(fichier)) ?? (await mp4(fichier)) ?? {};
    if (!t.titre || !t.artiste) {
      const ancien = await id3v1(fichier);
      t = { titre: t.titre || ancien.titre, artiste: t.artiste || ancien.artiste };
    }
  } catch {
    // Étiquette abîmée : on se rabat sur le nom du fichier.
  }
  return { titre: t.titre || '', artiste: t.artiste || '' };
}
