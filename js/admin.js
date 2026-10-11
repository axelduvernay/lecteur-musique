// Page admin (non liée dans l'interface) : morceaux retirés, rescan, changement de dossier.

import * as kv from './kv.js';
import { creerSource } from './source.js';
import { lireDonnees, titreParDefaut } from './donnees.js';

const $ = (id) => document.getElementById(id);
const source = creerSource();
const canal = 'BroadcastChannel' in window ? new BroadcastChannel('lecteur') : null;

// Le lecteur, s'il est ouvert, se recharge pour tenir compte du changement.
const prevenir = () => canal?.postMessage('maj');

async function afficher() {
  let etat;
  try {
    etat = await source.init();
  } catch {
    etat = 'installer';
  }
  $('autoriser').hidden = etat !== 'autoriser';
  $('changer').hidden = source.type !== 'pc';
  $('rescanner').hidden = etat !== 'pret';
  $('masques').replaceChildren();
  $('aucun').hidden = true;
  if (etat !== 'pret') {
    $('resume').textContent = etat === 'autoriser'
      ? `Dossier « ${source.nomDossier} » : accès à autoriser.`
      : 'Aucun dossier de musique choisi.';
    return;
  }

  const donnees = await lireDonnees(source);
  const presents = new Set(await source.listTracks());
  const meta = (await kv.lire('meta').catch(() => null)) || {};
  const ou = source.type === 'pc' ? `Dossier « ${source.nomDossier} »` : 'Stockage de l’appareil';
  $('resume').textContent = `${ou} : ${presents.size} morceau(x), dont ${donnees.masques.length} retiré(s).`;
  $('aucun').hidden = donnees.masques.length > 0;

  for (const id of donnees.masques) {
    const li = document.createElement('li');
    const texte = document.createElement('span');
    texte.textContent = (meta[id] && meta[id][0]) || titreParDefaut(id);
    const detail = document.createElement('small');
    detail.textContent = presents.has(id) ? id : `${id} — fichier absent`;
    texte.append(detail);
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = 'Remettre';
    bouton.addEventListener('click', async () => {
      const frais = await lireDonnees(source);
      frais.masques = frais.masques.filter((m) => m !== id);
      await source.writeData(frais);
      prevenir();
      afficher();
    });
    li.append(texte, bouton);
    $('masques').append(li);
  }
}

$('autoriser').addEventListener('click', async () => {
  await source.autoriser().catch(() => false);
  afficher();
});

// Oublie les titres déjà lus : tout le dossier sera relu au prochain lancement.
$('rescanner').addEventListener('click', async () => {
  await kv.effacer('meta').catch(() => {});
  prevenir();
  afficher();
});

$('changer').addEventListener('click', async () => {
  try {
    await source.choisirDossier();
  } catch {
    return; // choix annulé
  }
  prevenir();
  afficher();
});

afficher();
