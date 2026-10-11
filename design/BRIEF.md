# Brief — App musique « Ma musique »

Web app ultra simple pour écouter une bibliothèque de MP3 en aléatoire. Utilisateur : Rico, pas technophile.
Doit s'ouvrir dans Chrome (PC Windows, un peu lent) et sur iPad.

## Maquettes

- `design/maquette-pc.dc.html` — écran PC (référence principale, interactive)
- `design/maquette-ipad.dc.html` — écran iPad portrait

Ce sont des fichiers d'un outil de design. Reproduire **le rendu visuel exact** (couleurs, tailles, espacements, rayons, polices) à partir des styles inline.
Ignorer la mécanique propre à l'outil : `<x-dc>`, `<helmet>`, `<sc-if>`, `<sc-for>`, `{{ … }}`, `support.js`, `class Component extends DCLogic`.
La logique JS de la maquette PC (aléatoire, historique, favoris, tri, recherche) peut servir de base.

## Stack

- Site statique, hébergé sur GitHub Pages. HTML/CSS/JS sans framework (ou Vite si vraiment utile).
- Aucun serveur, aucun envoi de fichier sur internet : la musique reste en local.
- Léger et rapide (PC lent). Pas de grosse librairie.

## Fonctionnalités

1. **Message d'accueil** en haut à gauche, animé à l'ouverture (effet machine à écrire) :
   « Salut Rico ! On écoute quoi ce matin ? » — pause après « Rico ! », curseur orange qui disparaît à la fin.
2. **Définir le dossier** (bouton en haut à droite) — choisit le dossier de MP3.
   - PC (Chrome) : `showDirectoryPicker()` ; garder le handle dans IndexedDB pour ne pas redemander à chaque ouverture (redemander la permission en lecture si besoin) ; rescanner le dossier à chaque ouverture pour voir les nouveaux morceaux.
   - iPad : pas d'accès dossier dans le navigateur → `<input type="file" multiple accept="audio/mpeg,.mp3">`, puis copier les fichiers dans l'OPFS (`navigator.storage.getDirectory()`) pour qu'ils restent disponibles.
3. **Lecture des métadonnées** (titre, artiste, durée) depuis les tags ID3. Repli : nom de fichier `Artiste - Titre.mp3`, sinon nom de fichier seul.
4. **Barre latérale** : « Favoris » et « Tout », avec le nombre de morceaux. Sur iPad : contrôle segmenté au-dessus de la liste.
5. **Liste** : titre, artiste, durée. Clic = lecture. Morceau en cours en orange + petit égaliseur animé.
   Recherche (titre ou artiste) + tri Titre / Artiste.
6. **Favoris** : cœur sur chaque ligne (PC : visible au survol, toujours visible si favori) et dans le lecteur. Sauvegarde en `localStorage`.
7. **Lecteur** : vinyle qui tourne pendant la lecture, titre, artiste, barre de progression fine (temps écoulé / temps restant), boutons aléatoire · précédent · lecture/pause · suivant · favori, volume, ligne « Ensuite : … ».
8. **Aléatoire** : activé par défaut. Pas de répétition tant que tous les morceaux n'ont pas été joués (mélange de type « sac »). « Précédent » revient au morceau d'avant (historique), ou au début si > 3 s écoulées.
   Le bouton « Lecture aléatoire » lance l'aléatoire sur la vue en cours (Tout ou Favoris).
9. Enchaînement automatique au morceau suivant. Barre espace = lecture/pause. Mémoriser volume et vue.

## Design (à respecter)

- Esprit : minimaliste, premium, beaucoup d'air — inspiration Apple. Peu de boutons, un seul bouton plein (« Lecture aléatoire »).
- Couleurs : fond `#F5EFE7` · surface lecteur `#FBF8F3` · champs `#ECE4DA` · filets `#E5DBCF` · texte `#1D1A17` · texte secondaire `#6E6359` · accent orange `#C24E12` (texte orange : `#A8430F`).
- Polices (Google Fonts) : **Instrument Serif** (message d'accueil uniquement, 2ᵉ phrase en italique) + **Inter** 400/500/600 pour tout le reste.
- Cibles cliquables ≥ 44 px, texte de liste ≥ 16 px, bon contraste (l'utilisateur est âgé).
- Responsive : la mise en page PC doit se replier proprement sur iPad.
