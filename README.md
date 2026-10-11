# Musique — lecteur très simple

Lecteur de musique pour une personne peu à l'aise avec l'informatique : sa bibliothèque, ses favoris,
un vinyle qui tourne, tout en aléatoire. Site statique (HTML / CSS / JavaScript, sans framework ni étape de build), installable
comme application (PWA). Aucun compte, aucun serveur, aucune musique dans ce dépôt : les morceaux restent
sur l'appareil.

Le cahier des charges complet est dans [CLAUDE.md](CLAUDE.md).

## Installation sur le PC (Chrome)

1. Ouvrir l'adresse du site dans Chrome.
2. Cliquer sur « Choisir le dossier » et désigner le dossier de musique (une seule fois).
   Quand Chrome demande l'autorisation, répondre **« Autoriser à chaque visite »**.
3. Menu ⋮ de Chrome → « Caster, enregistrer et partager » → « Installer la page en tant qu'application » :
   une icône « Musique » apparaît sur le bureau.

Les morceaux ajoutés plus tard dans le dossier apparaissent tout seuls au lancement suivant.
Favoris, volume et vue sont enregistrés dans `.lecteur-data.json`, à la racine du dossier de musique.

## Installation sur l'iPad (Safari)

1. Ouvrir l'adresse du site dans Safari → bouton Partager → « Sur l'écran d'accueil ».
2. Lancer l'app depuis l'écran d'accueil, puis « Ajouter des morceaux » : les fichiers choisis sont copiés
   dans le stockage de l'app. Le volume se règle avec les boutons de l'iPad.

## Page admin

`admin.html` (non liée dans l'interface) : remettre un morceau masqué, rescanner le dossier,
changer de dossier de musique.

## Design

Maquette et brief dans `design/`. Polices Inter et Newsreader (licence OFL) copiées dans `fonts/`.

## Essai en local

```bash
python3 -m http.server 8765
```

Puis ouvrir `http://127.0.0.1:8765/`. Ajouter `?source=ipad` à l'adresse pour essayer la version iPad
sur un ordinateur. Le service worker n'est pas activé en local.

## Mise en ligne

GitHub Pages, depuis la branche `main` (dossier racine).
**À chaque mise en ligne, augmenter `VERSION` dans [sw.js](sw.js)**, sinon la mise à jour n'arrive pas
chez l'utilisateur. Elle s'applique au deuxième lancement après la mise en ligne.

## Reste à vérifier sur les vrais appareils

- PC : la permission d'accès au dossier tient d'un lancement à l'autre une fois l'app installée ;
  temps de lancement avec toute la bibliothèque (la première lecture des titres peut prendre quelques minutes,
  les suivantes sont immédiates).
- iPad : les morceaux importés sont toujours là après plusieurs jours ; la lecture continue et enchaîne
  écran verrouillé.
