// Couche « source » : même interface sur PC (dossier) et sur iPad (OPFS).
//   init() · listTracks() · getFile(id) · readData() · writeData(data)
// Pour essayer la version iPad sur un ordinateur : ajouter ?source=ipad à l'adresse.

import { creerSourcePC } from './source-pc.js';
import { creerSourceIPad } from './source-ipad.js';

export function creerSource() {
  const force = new URLSearchParams(location.search).get('source');
  const pc = force ? force === 'pc' : 'showDirectoryPicker' in window;
  return pc ? creerSourcePC() : creerSourceIPad();
}
