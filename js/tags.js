// Lecture du titre, de l'artiste et de la durée dans un fichier audio :
// ID3v2 (2.2, 2.3, 2.4), ID3v1, MP4 (.m4a) et WAV. Aucune dépendance.

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
// « suite » = position du premier octet de son, après l'étiquette.
async function id3v2(fichier) {
  let source = lecteurFichier(fichier);
  const tete = await source.octets(0, 10);
  if (tete.length < 10 || ascii(tete, 0, 3) !== 'ID3') return null;
  const version = tete[3];
  const drapeaux = tete[5];
  let pos = 10;
  let fin = 10 + synchsafe(tete, 6);
  const trouve = { suite: fin + (drapeaux & 0x10 ? 10 : 0) };
  if (version < 2 || version > 4) return trouve;

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
    if (version === 2) return trouve;
    const etendu = await source.octets(pos, 4);
    if (etendu.length < 4) return trouve;
    pos += version === 4 ? synchsafe(etendu, 0) : u32(etendu, 0) + 4;
  }

  const entete = version === 2 ? 6 : 10;
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

  const trouve = { duree: 0 };
  let boite = { debut: 0, fin: fichier.size };
  for (const nom of ['moov', 'udta', 'meta', 'ilst']) {
    boite = await trouver(boite.debut, boite.fin, nom);
    if (!boite) return trouve;
    if (nom === 'moov') {
      const mvhd = await trouver(boite.debut, boite.fin, 'mvhd');
      const o = mvhd ? await source.octets(mvhd.debut, 32) : [];
      if (o.length === 32) {
        const [echelle, duree] = o[0] === 1
          ? [u32(o, 20), u32(o, 24) * 2 ** 32 + u32(o, 28)]
          : [u32(o, 12), u32(o, 16)];
        if (echelle) trouve.duree = duree / echelle;
      }
    }
    if (nom === 'meta') {
      const d = await source.octets(boite.debut, 8);
      if (d.length === 8 && ascii(d, 4, 8) !== 'hdlr') boite.debut += 4;
    }
  }

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

// Durée d'un MP3 : en-tête Xing/Info ou VBRI s'il existe, sinon débit × taille.
const DEBITS = {
  11: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],    // MPEG 1, couche III
  12: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],   // MPEG 1, couche II
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],         // MPEG 2 et 2.5
};
const FREQUENCES = [44100, 48000, 32000];

async function dureeMP3(fichier, depart) {
  if (/\.aac$/i.test(fichier.name || '') || /aac/.test(fichier.type || '')) return 0; // connue à la lecture
  const o = new Uint8Array(await fichier.slice(depart, depart + BLOC).arrayBuffer());
  for (let i = 0; i + 4 <= o.length; i++) {
    if (o[i] !== 0xff || (o[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (o[i + 1] >> 3) & 3;  // 3 : MPEG 1 · 2 : MPEG 2 · 0 : MPEG 2.5
    const couche = (o[i + 1] >> 1) & 3;   // 1 : couche III · 2 : couche II
    const indiceDebit = o[i + 2] >> 4;
    const indiceFrequence = (o[i + 2] >> 2) & 3;
    if (version === 1 || (couche !== 1 && couche !== 2) || indiceDebit === 0 || indiceDebit === 15 || indiceFrequence === 3) continue;

    const mpeg1 = version === 3;
    const debit = (mpeg1 ? DEBITS[couche === 1 ? 11 : 12] : DEBITS[2])[indiceDebit] * 1000;
    const frequence = FREQUENCES[indiceFrequence] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
    const echantillons = couche === 1 && !mpeg1 ? 576 : 1152;
    const mono = (o[i + 3] >> 6) === 3;

    const xing = i + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    if (xing + 12 <= o.length) {
      const marque = ascii(o, xing, xing + 4);
      if ((marque === 'Xing' || marque === 'Info') && (o[xing + 7] & 1)) {
        return u32(o, xing + 8) * echantillons / frequence;
      }
    }
    const vbri = i + 36;
    if (vbri + 18 <= o.length && ascii(o, vbri, vbri + 4) === 'VBRI') {
      return u32(o, vbri + 14) * echantillons / frequence;
    }
    return (fichier.size - depart - i) * 8 / debit;
  }
  return 0;
}

// Renvoie null si le fichier n'est pas un WAV.
async function dureeWAV(fichier) {
  const source = lecteurFichier(fichier);
  const tete = await source.octets(0, 12);
  if (tete.length < 12 || ascii(tete, 0, 4) !== 'RIFF' || ascii(tete, 8, 12) !== 'WAVE') return null;
  const petit = (o, i) => (o[i] | (o[i + 1] << 8) | (o[i + 2] << 16) | (o[i + 3] << 24)) >>> 0;
  let debit = 0;
  for (let pos = 12; pos + 8 <= fichier.size;) {
    const t = await source.octets(pos, 16);
    if (t.length < 8) break;
    const nom = ascii(t, 0, 4);
    const taille = petit(t, 4);
    if (nom === 'fmt ') debit = petit(await source.octets(pos + 16, 4), 0);
    if (nom === 'data') return debit ? Math.min(taille, fichier.size - pos - 8) / debit : 0;
    pos += 8 + taille + (taille % 2);
  }
  return 0;
}

// Renvoie toujours { titre, artiste, duree } ; chaîne vide ou 0 quand l'information manque.
export async function lireTags(fichier) {
  let t = {};
  let duree = 0;
  try {
    const id3 = await id3v2(fichier);
    const m4a = id3 ? null : await mp4(fichier);
    t = id3 ?? m4a ?? {};
    if (m4a) {
      duree = m4a.duree;
    } else {
      duree = (id3 ? null : await dureeWAV(fichier)) ?? await dureeMP3(fichier, id3 ? id3.suite : 0);
    }
    if (!t.titre || !t.artiste) {
      const ancien = await id3v1(fichier);
      t = { titre: t.titre || ancien.titre, artiste: t.artiste || ancien.artiste };
    }
  } catch {
    // Étiquette abîmée : on se rabat sur le nom du fichier.
  }
  return { titre: t.titre || '', artiste: t.artiste || '', duree: Number.isFinite(duree) && duree > 0 ? duree : 0 };
}
