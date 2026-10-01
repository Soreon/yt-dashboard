# Global Video Feed

Un fil unique des dernières vidéos de vos abonnements YouTube, trié par date, avec des groupes de chaînes pour le filtrer. Application web en JavaScript pur : pas de build, pas de dépendances, pas de serveur applicatif. Tout est stocké dans le navigateur.

## Fonctionnalités

- **Connexion Google** via Google Identity Services (OAuth 2.0, *token model*) : aucun secret côté serveur.
- **Fil unifié** : les dernières vidéos de toutes vos chaînes, de la plus récente à la plus ancienne, sans les Shorts.
- **Synchronisation** : au chargement si la dernière date de plus d'une heure, ou à la demande.
- **Groupes** : regroupez des chaînes (Tech, Musique…) et filtrez le fil par groupe.
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
- **Gérer les groupes** (icône à côté) : nommez un groupe, cochez ses chaînes, puis « Créer le groupe ». Réutiliser un nom existant remplace le groupe.
- **Rechercher** : la barre du haut filtre le fil au fil de la frappe (titre ou chaîne, sans tenir compte des accents ni des majuscules).
- **Menu** (☰) : réduit ou déplie le menu latéral ; le choix est mémorisé.
- **Filtres** : « Tous » ou un groupe. Le filtre choisi est conservé après une synchronisation.
- **Session expirée** (le jeton Google dure environ 1 h) : le fil en cache reste affiché. Cliquez sur « Se connecter à YouTube » pour le mettre à jour.
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
| [js/groups.js](js/groups.js) | Fenêtre de gestion des groupes |

La mise en page est dans [index.html](index.html) et [styles.css](styles.css).

### Tests

Les tests unitaires utilisent l'exécuteur intégré à Node.js (version 18 ou plus), sans dépendance à installer :

```bash
npm test
```

### Données stockées (localStorage)

| Clé | Contenu |
| --- | --- |
| `yt_auth_token` | Jeton d'accès et date d'expiration |
| `yt_playlist_cache` | ID de chaîne → ID de sa playlist « uploads » |
| `yt_channel_names` | ID de chaîne → nom, pour la fenêtre des groupes |
| `yt_channel_avatars` | ID de chaîne → URL de son avatar |
| `yt_video_cache` | ID de chaîne → dernières vidéos (ID, titre, chaîne, date, miniature, durée, vues) |
| `yt_last_sync` | Date de la dernière synchronisation réussie |
| `yt_user_groups` | Nom du groupe → liste d'ID de chaînes |
| `yt_account` | Nom et avatar de votre chaîne, affichés en haut à droite |
| `yt_guide_collapsed` | Menu latéral réduit ou non |
| `yt_cache_version` | Version du format du cache (un cache plus ancien est reconstruit à la synchronisation suivante) |

Pour repartir de zéro : `localStorage.clear()` dans la console du navigateur.

## Quotas de l'API

Le quota par défaut est de 10 000 unités par jour et par projet Google Cloud. Chaque appel coûte 1 unité :

| Opération | Coût |
| --- | --- |
| Chargement des abonnements | 1 unité par tranche de 50 abonnements, plus 1 unité pour votre nom et votre avatar |
| Playlists des nouvelles chaînes | 1 unité par lot de 50 chaînes jamais vues |
| **Synchronisation** | **1 unité par chaîne**, plus 1 unité par lot de 50 vidéos récupérées (durées et vues) |

Exemple avec 200 abonnements : environ 5 unités par chargement, plus environ 220 unités par synchronisation, soit une cinquantaine de synchronisations par jour au maximum. La synchronisation automatique est limitée à une par heure ; « Forcer la synchro » ignore cette limite.

## Sécurité

- Les textes venant de l'API (titres, noms de chaînes) sont échappés avant d'être insérés dans la page (`escapeHtml`).
- Les identifiants de vidéos sont validés avant de construire un lien (`isValidYouTubeId`).
- Le jeton d'accès est stocké dans `localStorage` : il est lisible par tout script exécuté sur la même origine. Il est en lecture seule et expire au bout d'environ 1 h.
- Le Client ID OAuth est public par nature. Limitez les origines autorisées aux seuls domaines où l'application est servie.

## Limites connues

- Les groupes ne peuvent pas encore être modifiés ni supprimés depuis l'interface.
- Pas de synchronisation périodique tant que l'onglet reste ouvert : elle a lieu au chargement ou à la demande.

## Licence

MIT
