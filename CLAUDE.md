# Musique — lecteur de Rico

## Contexte
- Utilisateur : Rico, mon grand-père. Peu à l'aise avec l'informatique, utilise Chrome au quotidien. L'app remplace iTunes, qui fonctionne mal chez lui.
- Appareils : PC Windows un peu lent, écran desktop classique, souris. iPad en second.
- Usage principal : il lance tout en lecture aléatoire.
- **Principe n°1 : le strict minimum.** Chaque élément ajouté à l'interface doit être justifié.

## Références de design
- `design/BRIEF.md` et `design/maquette-pc.dc.html` (maquette d'un outil de design : ne lire que les styles, ignorer `<x-dc>`, `{{ … }}`, `support.js`).
- Demandes d'Axel par-dessus la maquette (12 oct. 2026) : rendu **Apple, vraiment premium**, encore plus d'air, petites animations très fluides partout, police d'accueil **moins condensée** que l'Instrument Serif de la maquette (→ Newsreader).
- Pas de maquette iPad fournie : le repli (vues en contrôle segmenté, lecteur en barre flottante) est déduit du brief.

## Stack
- Site statique : HTML / CSS / JavaScript vanilla (modules ES). Pas de framework, pas d'étape de build.
- Hébergement : GitHub Pages, dépôt public `axelduvernay/lecteur-musique`, branche `main`. **Aucun MP3 et aucun secret dans le repo.**
- PWA : `manifest.json` + service worker (cache des fichiers de l'app pour un lancement rapide).
- Aucune base de données, aucun compte, aucun backend, **aucun appel réseau au runtime** : les polices (Inter, Newsreader) sont copiées dans `fonts/`, pas de CDN.
- Formats lus : `.mp3` (principal), `.m4a`, `.aac`, `.wav`.

## Accès aux fichiers
Couche « source » commune, 2 implémentations choisies par détection (`'showDirectoryPicker' in window`) :
`listTracks()`, `getFile(id)`, `readData()`, `writeData(data)`.

### PC — Chrome (File System Access API)
- « Définir le dossier » : `showDirectoryPicker({ mode: 'readwrite' })`. Le handle est gardé dans IndexedDB ; aux lancements suivants `queryPermission` / `requestPermission`.
- Permission perdue : écran avec un seul bouton « Autoriser l'accès à ma musique ».
- Le dossier est rescanné à chaque lancement.
- Données de l'app (favoris, morceaux masqués, volume, vue) dans `.lecteur-data.json` à la racine du dossier musique (choix gardé plutôt que le `localStorage` du brief : les favoris suivent le dossier).

### iPad — Safari
- « Ajouter des morceaux » : `<input type="file" multiple>`, copie dans l'OPFS, `navigator.storage.persist()`. Données de l'app dans l'OPFS aussi.
- Le volume ne se règle pas depuis une page sur iOS : le curseur est masqué.
- **À tester sur l'appareil** : persistance du stockage dans le temps, lecture qui continue écran verrouillé.

## Interface (un seul écran)
- **En-tête** : message d'accueil en machine à écrire (« Salut Rico ! » puis, en italique, « On écoute quoi ce matin / cet après-midi / ce soir ? »), curseur orange qui s'efface ; bouton « Définir le dossier » (iPad : « Ajouter des morceaux »).
- **Vues** : « Favoris » et « Tout » avec le nombre de morceaux (barre latérale ; contrôle segmenté sous 1180 px). La vue est mémorisée.
- **Liste** : titre, artiste, durée ; clic = lecture (clic sur le morceau en cours = pause) ; morceau en cours en orange + égaliseur animé ; cœur par ligne (au survol sur PC, toujours visible si favori ou sur écran tactile) ; recherche sans accents ; tri Titre / Artiste.
- **Lecteur** : vinyle qui tourne, titre, artiste, barre de progression (clic ou glissement pour se déplacer), aléatoire · précédent · lecture/pause · suivant · favori, volume, « Ensuite : … ». Sous 860 px : barre flottante en bas.
- **Aléatoire** : actif à chaque lancement. Un morceau ne repasse pas tant que tous les autres de la vue ne sont pas passés, **même d'un lancement à l'autre** et même après un clic sur un morceau (mémoire `tour` dans IndexedDB). À la fin d'un tour, les derniers morceaux entendus (jusqu'à 25, un tiers de la vue au plus) attendent le tour suivant. « Précédent » : morceau d'avant, ou début du morceau si plus de 3 s écoulées. « Lecture aléatoire » lance l'aléatoire sur la vue affichée.
- La lecture porte sur la vue d'où elle a été lancée ; regarder l'autre vue ne change pas ce qui se joue.
- **Niveaux égalisés** (PC seulement) : chaque morceau est mesuré une fois en LUFS, juste avant ou pendant sa première écoute (`js/niveau.js`, résultat gardé dans `meta`). Ceux qui dépassent −16 LUFS sont baissés d'autant (12 dB au plus) ; **rien n'est jamais amplifié**. Pas de réglage dans l'interface. Sur iPad, une page ne peut pas régler le volume : pas d'égalisation.
- Barre d'espace = lecture / pause. Media Session (touches multimédia, écran verrouillé).
- Morceau illisible → suivant, sans message technique.
- Métadonnées : ID3 / MP4 ; repli sur `Artiste - Titre.mp3`, sinon le nom du fichier ; artiste absent → « Artiste inconnu ».
- « Retirer un morceau » n'est plus dans l'interface (absent de la maquette). Les morceaux masqués restent gérés par `admin.html` (page non liée : remettre un morceau, rescanner, changer de dossier).

## Design
- Couleurs : fond `#F5EFE7` · surface `#FBF8F3` · champs `#ECE4DA` · filets `#E5DBCF` · texte `#1D1A17` · secondaire `#6E6359` · accent `#C24E12` (texte orange `#A8430F`).
- Polices : Newsreader (message d'accueil uniquement) + Inter 400/500/600.
- Un seul bouton plein par écran. Cibles ≥ 44 px, texte de liste ≥ 16 px, bon contraste (utilisateur âgé).
- Animations : courbes `--doux` et `--ressort` de `style.css` ; tout est coupé avec `prefers-reduced-motion`.
- Mise en page à hauteur fixe (seule la liste défile) ; la carte du lecteur doit tenir entière jusqu'à 1366 × 650.
- Français simple, aucun jargon.

## Hors périmètre
Ajout de musique à distance, cloud, comptes, pochettes, playlists (hors favoris), égaliseur.

## Code
- `index.html`, `style.css` · `js/app.js` : état et interface · `js/lecteur.js` : `<audio>`, aléatoire, historique, « Ensuite ».
- `js/source.js` → `js/source-pc.js` (dossier) ou `js/source-ipad.js` (OPFS, + `js/opfs-worker.js` pour les vieux Safari).
- `js/niveau.js` : mesure du niveau sonore (ITU-R BS.1770), vérifiée contre `ffmpeg -af ebur128`.
- `js/tags.js` : titre, artiste et durée (ID3v2 / ID3v1 / MP4 / WAV), écrit pour le projet, aucune lib externe.
- `js/kv.js` : IndexedDB (dossier choisi, clé `tour` : mémoire de l'aléatoire, clé `meta` : `[titre, artiste, durée, niveau]` déjà lus) · `js/donnees.js` : données et replis de nom.
- `admin.html`, `js/admin.js` · `sw.js` : cache.
- Essai local : `python3 -m http.server 8765` puis `http://127.0.0.1:8765/` (pas de service worker en local). `?source=ipad` pour essayer la version iPad sur un ordinateur.

## Déploiement
- GitHub Pages depuis `main`. **Incrémenter `VERSION` dans `sw.js` à chaque mise en ligne**, et y ajouter tout nouveau fichier.

## Reste à faire
- Essais sur le vrai PC (installation Chrome, permission qui persiste, vitesse avec toute la bibliothèque) et le vrai iPad.
