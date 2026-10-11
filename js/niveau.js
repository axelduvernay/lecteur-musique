// Mesure du niveau sonore d'un morceau, en LUFS (méthode ITU-R BS.1770, celle des
// plateformes de streaming). Sert à baisser les morceaux trop forts ; rien n'est amplifié.

const FREQUENCE = 22050;  // décodage allégé : suffisant pour juger le niveau
const TAILLE_MAX = 160e6; // au-delà, le fichier n'est pas mesuré

const pause = () => new Promise((ok) => setTimeout(ok));

// Les deux filtres « K » de la norme, calculés pour la fréquence d'échantillonnage utilisée.
function filtres(fs) {
  let k = Math.tan(Math.PI * 1681.974450955533 / fs);
  const q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const etagere = [
    (vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0,
    2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0,
  ];
  k = Math.tan(Math.PI * 38.13547087602444 / fs);
  const q2 = 0.5003270373238773;
  a0 = 1 + k / q2 + k * k;
  const passeHaut = [1, -2, 1, 2 * (k * k - 1) / a0, (1 - k / q2 + k * k) / a0];
  return [etagere, passeHaut];
}

// Renvoie le niveau en LUFS, ou null si le morceau ne peut pas être mesuré.
export async function mesurerNiveau(fichier) {
  const Contexte = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Contexte || fichier.size > TAILLE_MAX) return null;
  let contexte;
  try {
    contexte = new Contexte(2, 1, FREQUENCE);
  } catch {
    contexte = new Contexte(2, 1, 44100);
  }
  const son = await contexte.decodeAudioData(await fichier.arrayBuffer());

  const tranche = Math.round(son.sampleRate / 10); // 100 ms
  const nombre = Math.floor(son.length / tranche);
  if (nombre < 4) return null;
  const energie = new Float64Array(nombre);
  const [[b0, b1, b2, a1, a2], [d0, d1, d2, c1, c2]] = filtres(son.sampleRate);
  const canaux = Math.min(2, son.numberOfChannels);

  for (let c = 0; c < canaux; c++) {
    const x = son.getChannelData(c);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let t = 0, i = 0; t < nombre; t++) {
      let somme = 0;
      for (const fin = i + tranche; i < fin; i++) {
        const e = x[i];
        const y = b0 * e + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        const z = d0 * y + d1 * y1 + d2 * y2 - c1 * z1 - c2 * z2;
        x2 = x1; x1 = e;
        y2 = y1; y1 = y;
        z2 = z1; z1 = z;
        somme += z * z;
      }
      energie[t] += somme / tranche;
      if (t % 600 === 599) await pause(); // laisse respirer l'interface
    }
  }
  // Un fichier mono sort sur les deux enceintes : il compte double.
  const poids = canaux === 1 ? 2 : 1;

  // Blocs de 400 ms qui se chevauchent, puis les deux seuils de la norme (silences écartés).
  const blocs = [];
  for (let t = 0; t + 4 <= nombre; t++) {
    blocs.push(poids * (energie[t] + energie[t + 1] + energie[t + 2] + energie[t + 3]) / 4);
  }
  const lufs = (m) => -0.691 + 10 * Math.log10(m);
  const moyenne = (liste) => liste.reduce((s, v) => s + v, 0) / liste.length;
  let gardes = blocs.filter((m) => m > 0 && lufs(m) > -70);
  if (!gardes.length) return null;
  const seuil = lufs(moyenne(gardes)) - 10;
  gardes = gardes.filter((m) => lufs(m) > seuil);
  return gardes.length ? Math.round(lufs(moyenne(gardes)) * 10) / 10 : null;
}
