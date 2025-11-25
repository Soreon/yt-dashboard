# YouTube Dashboard - Interface Visuelle

## Vue d'ensemble de l'interface

### Header
```
┌─────────────────────────────────────────────────────────────┐
│ YouTube Dashboard              [Sign in with Google]  [Se déconnecter] │
└─────────────────────────────────────────────────────────────┘
```

### Statistiques
```
┌─────────────────────────────────────────────────────────────┐
│ Abonnements: 150        Cache localStorage: 148             │
└─────────────────────────────────────────────────────────────┘
```

### Grille de chaînes (Responsive Grid)

**Desktop (3-4 colonnes):**
```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│  Image  │ │  Image  │ │  Image  │ │  Image  │
│ ─────── │ │ ─────── │ │ ─────── │ │ ─────── │
│ O Title │ │ O Title │ │ O Title │ │ O Title │
│ ✓ Cached│ │ ✓ Cached│ │ Playlist│ │ ✓ Cached│
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

**Tablette (2 colonnes):**
```
┌─────────────────┐ ┌─────────────────┐
│     Image       │ │     Image       │
│ ─────────────── │ │ ─────────────── │
│ O Channel Title │ │ O Channel Title │
│ ✓ Cached        │ │ Playlist ID     │
└─────────────────┘ └─────────────────┘
```

**Mobile (1 colonne):**
```
┌───────────────────────────────┐
│         Image Preview         │
│ ───────────────────────────── │
│ O  Channel Name               │
│    ✓ Cached                   │
└───────────────────────────────┘
```

## États de l'interface

### 1. Non authentifié
- Bouton "Sign in with Google" visible
- Grid vide
- Aucune statistique affichée

### 2. Chargement
```
┌─────────────────────────────────────┐
│              ⟳                      │
│   Chargement des abonnements...    │
└─────────────────────────────────────┘
```

### 3. Erreur 401
```
┌─────────────────────────────────────┐
│ ❌ Session expirée. Veuillez vous   │
│    reconnecter.                     │
└─────────────────────────────────────┘
```

### 4. Données chargées
- Grille complète avec toutes les chaînes
- Statistiques affichées
- Indicateurs de cache visibles

## Palette de couleurs

### Dark Theme (YouTube-inspired)
- **Background:** `#0f0f0f` (Noir profond)
- **Cards:** `#1f1f1f` (Gris foncé)
- **Primary:** `#ff0000` (Rouge YouTube)
- **Text Primary:** `#ffffff` (Blanc)
- **Text Secondary:** `#aaaaaa` (Gris clair)

### Indicateurs
- **✓ Cached:** Vert (#10b981) - Données en cache
- **Playlist ID:** Gris (#282828) - Données fraîches

## Interactions

### Hover sur carte
- Élévation: `translateY(-4px)`
- Ombre: Rouge avec opacité
- Transition: 0.3s ease

### Click sur carte
- Ouvre la playlist uploads si disponible
- Sinon, ouvre la page de la chaîne
- Nouvel onglet

## Responsive Breakpoints

- **Desktop:** > 768px (3-4 colonnes)
- **Tablette:** 480px - 768px (2 colonnes)
- **Mobile:** < 480px (1 colonne)

## Accessibilité

- Attributs `alt` sur toutes les images
- `loading="lazy"` pour images
- Contraste élevé pour lisibilité
- Focus visible sur éléments interactifs
- Sémantique HTML appropriée
