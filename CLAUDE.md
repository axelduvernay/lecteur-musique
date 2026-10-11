# Lecteur musique — Grand-père

## Contexte
- Utilisateur : mon grand-père. Peu à l'aise avec l'informatique, utilise Chrome au quotidien. L'app remplace iTunes, qui fonctionne mal chez lui.
- Appareils : PC Windows un peu lent, écran desktop classique, souris. iPad en second.
- Usage principal : il lance tout en lecture aléatoire.
- **Principe n°1 : le strict minimum.** Chaque élément ajouté à l'interface doit être justifié.

## Stack
- Site statique : HTML / CSS / JavaScript vanilla (modules ES). Pas de framework, pas d'étape de build.
- Hébergement : GitHub Pages (repo public). **Aucun MP3 et aucun secret dans le repo.**
- PWA : `manifest.json` + service worker (cache des fichiers de l'app pour un lancement rapide).
  - PC : installable via Chrome (« Installer l'application ») → icône sur le bureau.
  - iPad : « Sur l'écran d'accueil » dans Safari.
- Aucune base de données, aucun compte, aucun backend, aucun appel réseau au runtime.
- Lecture des métadonnées (titre, artiste) : petite lib ID3 copiée dans le repo (pas de CDN). Si pas de métadonnées → titre = nom du fichier sans extension, artiste = « Artiste inconnu ».
- Formats lus : `.mp3` (principal), `.m4a`, `.aac`, `.wav`.

## Accès aux fichiers
Créer une couche « source » commune avec 2 implémentations, choisie par détection (`'showDirectoryPicker' in window`) :
`listTracks()`, `getFile(id)`, `readData()`, `writeData(data)`.

### PC — Chrome (File System Access API)
- Premier lancement : `showDirectoryPicker({ mode: 'readwrite' })` → je choisis son dossier musique (une seule fois).
- Stocker le `FileSystemDirectoryHandle` dans IndexedDB. Aux lancements suivants : `queryPermission` / `requestPermission`. Une app installée garde la permission.
- Si la permission est perdue : afficher un seul gros bouton « Autoriser l'accès à ma musique ».
- Rescanner le dossier à chaque lancement → les morceaux ajoutés dans le dossier apparaissent automatiquement.
- Données de l'app (favoris, morceaux masqués, volume) dans `.lecteur-data.json` à la racine du dossier musique.

### iPad — Safari (pas de sélection de dossier possible)
- Bouton « Ajouter des morceaux » : `<input type="file" multiple accept="audio/*">`, puis copie des fichiers dans l'OPFS (`navigator.storage.getDirectory()`).
- Appeler `navigator.storage.persist()`.
- Données de l'app stockées dans l'OPFS aussi.
- Si le nom de fichier est perdu à l'import, se baser sur les métadonnées.
- **À tester tôt** : persistance du stockage dans le temps, lecture qui continue écran verrouillé.

## Écran principal
- **Au lancement** : un très grand bouton « ▶ Écouter », centré → lance tous les morceaux (non masqués) en aléatoire.
- **Pendant la lecture** :
  - Titre et artiste en gros.
  - ♥ Favori, visible à côté du titre (bascule ajouté / retiré).
  - Boutons : ⏮ Précédent · ⏸ Pause / ▶ Reprendre · ⏭ Suivant.
  - Volume : grand curseur dans l'app.
  - Menu ⋯ à côté du morceau : « Retirer ce morceau ».
- Aléatoire toujours actif, **pas de bouton pour le couper**. Ordre mélangé (Fisher-Yates) ; « Précédent » revient dans l'historique ; en fin de liste, nouveau mélange sans répéter le dernier morceau.
- Pas de pochette.
- Lien discret en bas : « Choisir un morceau ».
- La musique ne s'arrête jamais en changeant d'écran (une seule page, un seul élément `<audio>`).
- Morceau illisible → passer automatiquement au suivant, sans message d'erreur technique.

## Écran « Choisir un morceau »
- Champ de recherche (titre ou artiste).
- Tri : titre / artiste. Filtre par artiste.
- Filtre « ♥ Mes favoris » + bouton « Écouter mes favoris en aléatoire ». *(Fonctionnement des favoris à valider.)*
- Grande liste ; un clic sur un morceau → lecture.
- Bouton « ← Retour » toujours visible.
- Sur iPad uniquement : bouton « Ajouter des morceaux ».

## Retirer un morceau
- Ne supprime **jamais** le fichier : le morceau est seulement masqué dans l'app.
- Confirmation obligatoire : « Retirer ce morceau ? » → « Oui » / « Non ».
- Page `admin.html`, non liée dans l'interface (pour moi) :
  - liste des morceaux masqués avec un bouton « Remettre » ;
  - rescanner le dossier ;
  - changer de dossier musique.

## Règles UX
- Responsive : pensé d'abord pour un écran desktop à la souris, doit fonctionner sur iPad et téléphone.
- Tout est gros : bouton « Écouter » énorme, autres boutons ≥ 64 px de haut, texte courant ≥ 20 px, titre du morceau ≥ 32 px.
- Contraste élevé (WCAG AA minimum).
- Simple clic partout. Rien qui dépende du survol, du double-clic, du clic droit ou du glisser-déposer.
- Toujours une icône **avec** un libellé texte, jamais une icône seule.
- Menu ⋯ : grandes zones cliquables, texte clair.
- Français simple, aucun jargon.
- Animations courtes et discrètes.
- Media Session API : titre/artiste dans les contrôles système, touches multimédia du clavier, écran verrouillé de l'iPad.

## Hors périmètre
Ajout de musique à distance, cloud, comptes, pochettes, playlists (hors favoris), égaliseur.

## Ordre de développement
1. Squelette PWA + accès au dossier sur PC + lecture aléatoire basique.
2. Contrôles : précédent, pause, suivant, volume + Media Session.
3. Métadonnées + écran « Choisir un morceau ».
4. Favoris + retirer un morceau + fichier `.lecteur-data.json`.
5. Page admin.
6. Version iPad (import + OPFS).
7. Test sur le PC du grand-père : installation Chrome, permission qui persiste, lancement rapide.

## Déploiement
- GitHub Pages depuis la branche `main`.
- Incrémenter la version du cache du service worker à chaque mise en ligne, pour que la mise à jour arrive chez lui.

## État du code (octobre 2026)
Étapes 1 à 6 codées et vérifiées dans un navigateur de bureau ; reste l'étape 7 (essais sur le vrai PC et le vrai iPad).
- `index.html`, `style.css` : une seule page, deux écrans (principal, « Choisir un morceau »).
- `js/app.js` : état et interface · `js/lecteur.js` : `<audio>`, aléatoire, historique.
- `js/source.js` → `js/source-pc.js` (dossier) ou `js/source-ipad.js` (OPFS, + `js/opfs-worker.js` pour les vieux Safari).
- `js/tags.js` : lecteur ID3v2 / ID3v1 / MP4 écrit pour le projet (aucune lib externe).
- `js/kv.js` : IndexedDB (dossier choisi + titres déjà lus, clé `meta`) · `js/donnees.js` : favoris, masqués, volume.
- `admin.html`, `js/admin.js` : page admin · `sw.js` : cache (`VERSION` à incrémenter à chaque mise en ligne).
- Essai local : `python3 -m http.server 8765` puis `http://127.0.0.1:8765/` (pas de service worker en local).
  Ajouter `?source=ipad` pour essayer la version iPad sur un ordinateur.
- Choix à valider (favoris) : « Écouter mes favoris » ne joue que les favoris, un bandeau « Vous écoutez vos favoris »
  avec « Tout écouter » permet d'en sortir ; choisir un morceau hors favoris revient à tout.
