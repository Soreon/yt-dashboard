# Configuration du YouTube Dashboard

## Prérequis

1. **Créer un projet Google Cloud Console**
   - Accédez à https://console.cloud.google.com/
   - Créez un nouveau projet ou sélectionnez un projet existant

2. **Activer l'API YouTube Data v3**
   - Dans la console, allez à "APIs & Services" > "Library"
   - Recherchez "YouTube Data API v3"
   - Cliquez sur "Enable"

3. **Créer une clé API**
   - Allez à "APIs & Services" > "Credentials"
   - Cliquez sur "Create Credentials" > "API key"
   - Copiez la clé générée

4. **Créer un OAuth 2.0 Client ID**
   - Dans "Credentials", cliquez sur "Create Credentials" > "OAuth client ID"
   - Choisissez "Web application"
   - Ajoutez vos origines autorisées (ex: http://localhost:8000, https://votre-domaine.com)
   - Copiez le Client ID généré

## Installation

1. **Modifier app.js**
   - Ouvrez `app.js`
   - Remplacez `YOUR_API_KEY` par votre clé API
   - Remplacez `YOUR_CLIENT_ID.apps.googleusercontent.com` par votre OAuth Client ID

2. **Modifier index.html**
   - Ouvrez `index.html`
   - Remplacez `YOUR_CLIENT_ID.apps.googleusercontent.com` dans l'attribut `data-client_id`

## Utilisation

1. **Servir l'application**
   ```bash
   # Option 1: Python
   python -m http.server 8000
   
   # Option 2: Node.js
   npx http-server -p 8000
   
   # Option 3: PHP
   php -S localhost:8000
   ```

2. **Accéder à l'application**
   - Ouvrez votre navigateur
   - Accédez à http://localhost:8000

3. **Se connecter**
   - Cliquez sur le bouton "Sign in with Google"
   - Autorisez l'accès à votre compte YouTube
   - Vos abonnements seront chargés automatiquement

## Fonctionnalités

### 1. Authentification Google Identity Services (Token Model)
- Utilise le modèle de jeton OAuth 2.0
- Pas de secret backend requis
- Authentification sécurisée côté client

### 2. Récupération récursive des abonnements
- Récupère TOUS les abonnements via pagination
- Utilise `subscriptions.list` avec `maxResults=50`
- Continue jusqu'à ce que `nextPageToken` soit null

### 3. Batching des requêtes channels.list
- **CRITIQUE**: Groupe les IDs de chaînes par lots de 50
- Optimise les appels API pour économiser le quota
- Extrait l'ID de la playlist "uploads" via ContentDetails

### 4. Persistance localStorage
- Cache le mapping ChannelID → PlaylistID
- Réduit drastiquement la consommation de quota API
- Persiste entre les sessions du navigateur

### 5. Interface utilisateur moderne
- Grid responsive CSS moderne
- S'adapte aux écrans mobiles, tablettes et desktop
- Gestion des erreurs 401 (session expirée)
- Indicateurs visuels pour les entrées en cache

## Quotas API YouTube

L'API YouTube Data v3 a une limite de quota quotidienne de 10,000 unités par défaut.

Coûts par opération:
- `subscriptions.list`: 1 unité par requête
- `channels.list`: 1 unité par requête

Avec le batching et le cache:
- Premier chargement: ~2-20 unités (selon le nombre d'abonnements)
- Chargements suivants: ~1-5 unités (grâce au cache localStorage)

## Dépannage

### Erreur 401 - Session expirée
- L'application se déconnecte automatiquement
- Reconnectez-vous pour obtenir un nouveau jeton

### Abonnements non chargés
- Vérifiez la console du navigateur pour les erreurs
- Assurez-vous que l'API YouTube est activée
- Vérifiez que les clés API et OAuth sont correctes

### Cache localStorage
- Pour vider le cache: ouvrez la console et tapez `localStorage.clear()`
- Le cache se reconstruit automatiquement au prochain chargement
