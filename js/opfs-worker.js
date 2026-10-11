// Écriture d'un fichier dans l'OPFS pour les Safari sans createWritable().

self.onmessage = async ({ data: { id, chemin, nom, blob } }) => {
  try {
    let repertoire = await navigator.storage.getDirectory();
    for (const partie of chemin) repertoire = await repertoire.getDirectoryHandle(partie, { create: true });
    const poignee = await repertoire.getFileHandle(nom, { create: true });
    const octets = new Uint8Array(await blob.arrayBuffer());
    const acces = await poignee.createSyncAccessHandle();
    try {
      acces.truncate(0);
      acces.write(octets, { at: 0 });
      acces.flush();
    } finally {
      acces.close();
    }
    self.postMessage({ id, ok: true });
  } catch (e) {
    self.postMessage({ id, ok: false, message: String(e) });
  }
};
