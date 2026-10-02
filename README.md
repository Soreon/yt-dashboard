# Global Video Feed

Un fil unique des dernières vidéos de vos abonnements YouTube, trié par date, avec des groupes de chaînes pour le filtrer. Application web en JavaScript pur : pas de build, pas de dépendances, pas de serveur applicatif. Tout est stocké dans le navigateur.

## Fonctionnalités

- **Connexion Google** via Google Identity Services (OAuth 2.0, *token model*) : aucun secret côté serveur.
- **Fil unifié** : les dernières vidéos de toutes vos chaînes, de la plus récente à la plus ancienne, sans les Shorts, en grille de cartes ou en liste compacte (bouton en haut à droite, comme dans Google Drive).
- **Synchronisation** : au chargement, puis automatiquement tant que l'onglet est ouvert (au plus toutes les 30 minutes), ou à la demande.
- **Groupes** : regroupez des chaînes (Tech, Musique…) et filtrez le fil par groupe. Une page dédiée montre chaque groupe (chaînes, vidéos non vues, dernière vidéo), les chaînes sans groupe, et permet d'ajouter une chaîne à plusieurs groupes.
- **Vidéos vues** : une vidéo ouverte depuis le fil, ou marquée comme vue, n'y apparaît plus.
- **Historique** des vidéos vues, regroupées par jour, avec recherche, et import de votre historique YouTube (Google Takeout).
- **Recherche** dans le fil, par titre ou nom de chaîne.
- **Interface inspirée de YouTube** : mêmes codes de mise en page (cartes avec durée, vues et avatar de la chaîne, filtres en pastilles, menu latéral), thème clair ou sombre selon le système, adaptée au mobile.
- **Cache local** : le fil s'affiche instantanément depuis le cache, y compris quand la session a expiré.

## Installation

### 1. Créer l'identifiant OAuth (Google Cloud Console)

1. Sur https://console.cloud.google.com/, créez un projet (ou sélectionnez-en un).
2. **APIs & Services > Library** : activez **YouTube Data API v3**.
3. **APIs & Services > OAuth consent screen** : configurez l'écran de consentement (type *External*). Tant que l'application est en mode *Testing*, ajoutez votre compte Google dans les *Test users*.
4. **APIs & Services > Credentials > Create credentials > OAuth client ID** :
   - type d'application : *Web application* ;
   - *Authorized JavaScript origins* : `http://localhost:8000`, plus votre domaine de production le cas échéant.

Aucune clé API n'est nécessaire : toutes les requêtes passent par le jeton OAuth.

### 2. Configurer l'application

Dans [js/config.js](js/config.js), remplacez `CLIENT_ID` par votre identifiant :

```js
const CLIENT_ID = '123456789-abc....apps.googleusercontent.com';
```

### 3. Lancer

Servez le dossier avec n'importe quel serveur HTTP statique :

```bash
python -m http.server 8000
# ou
npx http-server -p 8000
```

Puis ouvrez http://localhost:8000. L'origine doit correspondre exactement à une origine autorisée : `http://127.0.0.1:8000` n'est pas équivalent à `http://localhost:8000`.

## Utilisation

- **Se connecter à YouTube** : autorise l'accès en lecture seule à vos abonnements (`youtube.readonly`). L'écran de consentement n'apparaît que la première fois.
- **Synchroniser** (icône ⟳ en haut à droite) : récupère immédiatement les dernières vidéos.
- **Groupes** (menu latéral, ou icône à côté de la synchro) : une carte par groupe, avec ses chaînes en mosaïque, le nombre de vidéos non vues et la date de sa dernière vidéo ; « Nouveau groupe » crée un groupe puis ouvre le choix des chaînes. Cliquer sur un groupe affiche ses chaînes (dernière vidéo, non-vues, autres groupes de la chaîne) ; chaque ligne a un menu « Ajouter à… » et « Retirer du groupe ». Une chaîne peut être dans plusieurs groupes. Le groupe se renomme, se supprime, et « Voir le fil » affiche le fil filtré dessus. « Sans groupe » liste les chaînes qui ne sont dans aucun groupe. Deux groupes ne peuvent pas porter le même nom ; un groupe renommé reste sélectionné dans les filtres.
- **Ordre et visibilité des groupes** : le menu ⋮ d'une carte monte ou descend le groupe dans les filtres du fil, ou le **masque du fil** : il garde ses chaînes et sa page, mais n'a plus de pastille dans les filtres (pratique pour « Archive »). Le menu ⋮ d'une chaîne propose aussi « Voir ses vidéos dans le fil » : le fil ne montre alors que cette chaîne, avec une pastille à fermer pour revenir à tout.
- **Chaînes inactives** : une chaîne dont la dernière vidéo connue a plus d'un an porte un badge « Inactive », et la page Groupes compte les inactives par groupe. « Inactives depuis plus d'un an » les liste toutes, de la plus récemment active à la plus ancienne, et « Tout déplacer vers Archive » les range dans un groupe « Archive » (créé au besoin) en les retirant de leurs autres groupes. L'activité est déduite des vidéos que l'application connaît : une chaîne jamais synchronisée n'est pas comptée.
- **Exporter / importer les groupes** (page Groupes) : « Exporter » télécharge un fichier JSON avec vos groupes et le nom de leurs chaînes ; « Importer » l'ajoute aux groupes d'un autre appareil ou navigateur. Un groupe importé qui porte le nom d'un groupe existant le complète avec les chaînes qui lui manquent : rien n'est supprimé.
- **Rechercher** : la barre du haut filtre la page affichée au fil de la frappe, sans tenir compte des accents ni des majuscules : le fil (titre ou chaîne), les groupes (nom du groupe ou d'une de ses chaînes) ou l'historique.
- **Menu** (☰) : réduit ou déplie le menu latéral ; le choix est mémorisé.
- **Vidéos vues** : ouvrir une vidéo (clic, clic molette) la marque comme vue. Sa carte reste affichée, grisée avec une barre rouge, pour ne pas décaler la grille pendant que vous en ouvrez plusieurs ; elle disparaît du fil quand vous revenez sur l'onglet. Le bouton ✓ d'une carte (au survol) la marque comme vue tout de suite, avec « Annuler » ; sur une carte grisée, il la remet en non vue.
- **Historique** (menu latéral, ou barre du bas sur téléphone) : les vidéos vues, des plus récentes aux plus anciennes, regroupées par jour. La barre de recherche y filtre l'historique. La croix d'une vidéo la retire de l'historique (elle revient dans le fil) ; « Effacer tout l'historique » vide la liste. Les 500 dernières vidéos vues sont conservées.
- **Importer votre historique YouTube** (page Historique) : l'API YouTube ne donne pas accès à l'historique, mais Google Takeout permet de l'exporter. Sur https://takeout.google.com/, ne sélectionnez que « YouTube et YouTube Music », ne gardez que l'historique, et choisissez le format **JSON** pour l'historique dans « Formats multiples » (le HTML proposé par défaut n'est pas pris en charge). Choisissez ensuite l'archive `.zip` téléchargée telle quelle (ou le fichier `watch-history.json` qu'elle contient) : toutes les vidéos regardées sont retirées du fil, et les 500 plus récentes rejoignent l'historique avec leur date de visionnage. Réimporter un export plus récent ne crée pas de doublon ; Takeout peut programmer un export tous les deux mois. Le fichier est lu dans le navigateur (décompression native, sans dépendance) et n'est envoyé nulle part.
- **Filtres** : « Tous » ou un groupe. Le filtre choisi est conservé après une synchronisation.
- **Synchronisation automatique** : toutes les 5 minutes et à chaque retour sur l'onglet, l'application synchronise si la dernière synchronisation date de plus de 30 minutes. Si de nouvelles vidéos arrivent alors que vous êtes descendu dans le fil, une pastille « Nouvelles vidéos » les affiche au lieu de déplacer la page.
- **Session expirée** (le jeton Google dure environ 1 h) : le fil en cache reste affiché et la synchronisation automatique s'arrête. Cliquez sur « Se connecter » pour reprendre.
- **Se déconnecter** (menu de votre avatar) : révoque le jeton et vide l'écran. Les caches et les groupes restent dans le navigateur.

## Fonctionnement

```
Connexion (jeton OAuth)
  → subscriptions.list   tous les abonnements, 50 par page
  → channels.list        playlist « uploads » de chaque nouvelle chaîne, par lots de 50
  → playlistItems.list   5 dernières vidéos (hors Shorts) de chaque chaîne, en parallèle
  → videos.list          durée et nombre de vues de ces vidéos, par lots de 50
  → fil trié par date, max 10 vidéos conservées par chaîne
```

- **Shorts** : les vidéos sont lues dans la playlist « vidéos longues » de chaque chaîne (`UULF…`, déduite de la playlist des mises en ligne `UU…`), qui exclut les Shorts. Cette playlist n'est pas documentée par l'API : si elle renvoie une erreur 404 pour une chaîne, l'application se rabat sur toutes ses mises en ligne, Shorts compris.
- Les chaînes dont vous vous êtes désabonné sont retirées des caches à chaque chargement des abonnements.
- Une synchronisation n'est marquée comme faite que si au moins une chaîne a été récupérée : en cas d'échec, la suivante a lieu au prochain chargement.
### Organisation du code

Modules JavaScript natifs, chargés directement par le navigateur, sans étape de build :

| Fichier | Rôle |
| --- | --- |
| [js/main.js](js/main.js) | Point d'entrée : connexion, chargement des abonnements, synchronisation |
| [js/config.js](js/config.js) | Client ID OAuth et constantes |
| [js/api.js](js/api.js) | Appels à l'API YouTube Data v3 |
| [js/storage.js](js/storage.js) | Lecture et écriture du `localStorage` |
| [js/feed.js](js/feed.js) | Logique pure du fil (fusion, tri, dates), sans DOM : testée unitairement |
| [js/ui.js](js/ui.js) | Affichage du fil, des filtres, du compte et des messages |
| [js/groups.js](js/groups.js) | Page Groupes : vue d'ensemble, détail d'un groupe, chaînes sans groupe |
| [js/history-model.js](js/history-model.js) | Vidéos vues, regroupement par jour et import Google Takeout, sans DOM : testée unitairement |
| [js/zip.js](js/zip.js) | Lecture d'une entrée d'archive zip avec la décompression native du navigateur : testée unitairement |
| [js/groups-model.js](js/groups-model.js) | Création, renommage, ajout et retrait de chaînes, activité des groupes, export et import, sans DOM : testée unitairement |

La mise en page est dans [index.html](index.html) et [styles.css](styles.css).

### Tests

**Tests unitaires** de la logique pure (`tests/*.test.js`), avec l'exécuteur intégré à Node.js (version 20 ou plus), sans dépendance :

```bash
npm test
```

**Tests de bout en bout** (`tests/e2e/`), avec [Playwright](https://playwright.dev) : l'application est servie localement et pilotée dans un vrai navigateur, tandis que Google Identity Services et l'API YouTube sont simulés par interception réseau (aucune requête ne sort, aucun compte n'est nécessaire). Ils couvrent la synchronisation, les sessions, les groupes, l'historique, l'import Takeout, la recherche, l'affichage mobile et l'échappement des titres.

```bash
npm install          # une fois
npm run test:e2e
```

En local, les tests utilisent le Google Chrome installé (pas de téléchargement de navigateur) ; en intégration continue, le Chromium de Playwright (`npx playwright install chromium`).

### Intégration continue et déploiement

Le workflow [.github/workflows/ci.yml](.github/workflows/ci.yml) lance les tests unitaires et les tests de bout en bout à chaque push et à chaque pull request. Sur `main`, le site n'est déployé sur GitHub Pages que si tous les tests passent ; seuls les fichiers du site sont publiés (`index.html`, `styles.css`, `favicon.svg`, `js/`). Un nouveau fichier nécessaire au site doit être ajouté à la liste de l'étape « Collect the site files ».

Cela suppose que GitHub Pages soit configuré pour être déployé par le workflow : **Settings → Pages → Build and deployment → Source : GitHub Actions**.

### Données stockées (localStorage)

| Clé | Contenu |
| --- | --- |
| `yt_auth_token` | Jeton d'accès et date d'expiration |
| `yt_playlist_cache` | ID de chaîne → ID de sa playlist « uploads » |
| `yt_channel_names` | ID de chaîne → nom, pour la fenêtre des groupes |
| `yt_channel_avatars` | ID de chaîne → URL de son avatar |
| `yt_video_cache` | ID de chaîne → dernières vidéos (ID, titre, chaîne, date, miniature, durée, vues) |
| `yt_last_sync` | Date de la dernière synchronisation réussie |
| `yt_user_groups` | Nom du groupe → liste d'ID de chaînes (l'ordre est celui des filtres) |
| `yt_hidden_groups` | Noms des groupes masqués dans les filtres du fil |
| `yt_account` | Nom et avatar de votre chaîne, affichés en haut à droite |
| `yt_guide_collapsed` | Menu latéral réduit ou non |
| `yt_feed_layout` | Affichage du fil : grille ou liste |
| `yt_watch_history` | Vidéos vues : date et informations de la vidéo (500 au plus, pour la page Historique) |
| `yt_watched_ids` | Identifiants de toutes les vidéos vues ou importées, sans limite, pour les masquer du fil |
| `yt_cache_version` | Version du format du cache (un cache plus ancien est reconstruit à la synchronisation suivante) |

Pour repartir de zéro : `localStorage.clear()` dans la console du navigateur.

## Quotas de l'API

Le quota par défaut est de 10 000 unités par jour et par projet Google Cloud. Chaque appel coûte 1 unité :

| Opération | Coût |
| --- | --- |
| Chargement des abonnements | 1 unité par tranche de 50 abonnements, plus 1 unité pour votre nom et votre avatar |
| Playlists des nouvelles chaînes | 1 unité par lot de 50 chaînes jamais vues |
| **Synchronisation** | **1 unité par chaîne**, plus 1 unité par lot de 50 vidéos récupérées (durées et vues) |

Exemple avec 200 abonnements : environ 5 unités par chargement, plus environ 220 unités par synchronisation, soit une cinquantaine de synchronisations par jour au maximum. La synchronisation automatique est limitée à une toutes les 30 minutes, et seulement pendant la session Google (environ 1 h) ; l'icône de synchronisation ignore cette limite.

## Sécurité

- Les textes venant de l'API (titres, noms de chaînes) sont échappés avant d'être insérés dans la page (`escapeHtml`).
- Les identifiants de vidéos sont validés avant de construire un lien (`isValidYouTubeId`).
- Le jeton d'accès est stocké dans `localStorage` : il est lisible par tout script exécuté sur la même origine. Il est en lecture seule et expire au bout d'environ 1 h.
- Le Client ID OAuth est public par nature. Limitez les origines autorisées aux seuls domaines où l'application est servie.

## Limites connues

- L'historique YouTube n'est pas accessible en direct (l'API ne le fournit plus depuis 2016) : il faut l'importer depuis Google Takeout, et réimporter un nouvel export pour le mettre à jour.
- Sans serveur, le jeton Google (environ 1 h) ne peut pas être renouvelé sans un clic : la synchronisation automatique s'interrompt à son expiration.

## Licence

MIT
