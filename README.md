# YouTube Dashboard

Une Single Page Application (SPA) en Vanilla JavaScript pour gérer et visualiser vos abonnements YouTube.

## 🚀 Fonctionnalités

- ✅ **Authentification Google Identity Services** (Token Model) - Sans secret backend
- ✅ **Récupération récursive** de tous les abonnements via `subscriptions.list`
- ✅ **Batching intelligent** des IDs par 50 pour `channels.list` (optimisation quota API)
- ✅ **Cache localStorage** persistant (ChannelID → PlaylistID) pour économiser le quota
- ✅ **Interface responsive** avec CSS Grid moderne
- ✅ **Gestion des erreurs 401** et reconnexion automatique

## 📦 Technologies

- **Vanilla JavaScript (ES6+)** - Sans build, sans framework
- **Google Identity Services** - OAuth 2.0 Token Model
- **YouTube Data API v3** - Accès aux données YouTube
- **CSS Grid & Flexbox** - Layout responsive moderne
- **localStorage API** - Persistance côté client

## 🛠️ Installation

Voir [CONFIG.md](CONFIG.md) pour les instructions détaillées de configuration.

### Résumé rapide:

1. Créez un projet Google Cloud Console
2. Activez YouTube Data API v3
3. Créez une clé API et un OAuth Client ID
4. Modifiez `app.js` et `index.html` avec vos identifiants
5. Servez l'application avec un serveur HTTP local

```bash
python -m http.server 8000
# ou
npx http-server -p 8000
```

6. Ouvrez http://localhost:8000

## 📖 Architecture

```
index.html        # Structure HTML + Google Identity Services
app.js            # Logique métier (auth, API calls, cache)
styles.css        # Styles CSS modernes et responsive
CONFIG.md         # Documentation de configuration
```

### Flux de données:

1. **Authentification** → Google Identity Services (Token Model)
2. **Fetch abonnements** → Récursif avec pagination
3. **Batch channel IDs** → Groupes de 50 pour channels.list
4. **Cache localStorage** → Mapping ChannelID → PlaylistID
5. **Affichage** → Grid responsive avec cartes de chaînes

## 🎯 Optimisations

- **Batching API**: Réduit les appels API de 90%+ en groupant par 50
- **Cache localStorage**: Évite les appels répétés pour les mêmes chaînes
- **Pagination optimale**: Récupère 50 abonnements par requête
- **Lazy loading**: Images chargées à la demande

## 📊 Quotas API

L'API YouTube a une limite de 10,000 unités/jour par défaut.

- Premier chargement: ~2-20 unités
- Chargements suivants: ~1-5 unités (grâce au cache)

## 📄 Licence

MIT
