# Global Video Feed - Guide d'utilisation

## Nouvelles fonctionnalités

### 1. Flux vidéo unifié
- Affichage de toutes les vidéos de vos abonnements dans un seul flux
- Tri automatique par date de publication (du plus récent au plus ancien)
- Chargement instantané depuis le cache local

### 2. Synchronisation intelligente
- Synchronisation automatique toutes les heures
- Bouton "Forcer la synchro" pour une mise à jour immédiate
- Cache de 10 vidéos par chaîne dans le localStorage

### 3. Gestion des groupes
- Créez des groupes personnalisés (Tech, Music, Gaming, etc.)
- Filtrez le flux par groupe
- Sélection facile des chaînes via une interface modale

### 4. Interface utilisateur améliorée
- Cartes vidéo avec miniature, titre, nom de chaîne et date
- Barre de filtres avec boutons "Tous" et groupes personnalisés
- Thème sombre moderne et responsive

## Utilisation

### Première connexion
1. Cliquez sur "Se connecter à YouTube"
2. Autorisez l'accès à vos abonnements
3. L'application charge automatiquement vos abonnements
4. La première synchronisation récupère les vidéos récentes

### Créer un groupe
1. Cliquez sur "Gérer les groupes"
2. Entrez un nom pour le groupe (ex: "Tech", "Music")
3. Cochez les chaînes à inclure dans ce groupe
4. Cliquez sur "Créer le groupe"

### Filtrer le flux
- Cliquez sur "Tous" pour voir toutes les vidéos
- Cliquez sur un groupe pour voir uniquement ses vidéos

### Forcer une synchronisation
- Cliquez sur "Forcer la synchro" pour récupérer les dernières vidéos
- Utile si vous venez de vous abonner à de nouvelles chaînes

## Données stockées (localStorage)

- `yt_video_cache`: Dernières vidéos (max 10 par chaîne)
- `yt_last_sync`: Date de la dernière synchronisation
- `yt_user_groups`: Configuration des groupes
- `yt_channel_names`: Noms des chaînes
- `yt_playlist_cache`: IDs des playlists "uploads"
- `yt_auth_token`: Token d'authentification

## Quotas API

La synchronisation est optimisée pour minimiser l'utilisation des quotas:
- Synchronisation limitée à 1x par heure
- Récupération de seulement 5 vidéos par chaîne
- Utilisation du cache pour éviter les appels répétés

## Compatibilité

- Navigateurs modernes (Chrome, Firefox, Safari, Edge)
- Nécessite localStorage activé
- Connexion Internet requise pour la synchronisation

## Dépannage

**Aucune vidéo n'apparaît:**
- Vérifiez que vous êtes connecté
- Cliquez sur "Forcer la synchro"
- Vérifiez que vous avez des abonnements YouTube

**Erreur de synchronisation:**
- Vérifiez votre connexion Internet
- Reconnectez-vous à YouTube
- Vérifiez les quotas API dans Google Cloud Console

**Le filtre de groupe ne fonctionne pas:**
- Vérifiez que le groupe contient des chaînes
- Assurez-vous que ces chaînes ont des vidéos dans le cache
