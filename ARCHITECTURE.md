# YouTube Dashboard SPA - Application Flow

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER BROWSER                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    index.html                              │ │
│  │  - Google Identity Services SDK                            │ │
│  │  - Sign-in button                                          │ │
│  │  - Subscriptions grid container                            │ │
│  │  - Loading indicators                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                            ↓                                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                      app.js                                │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  1. Authentication (Token Model)                     │ │ │
│  │  │     - initTokenClient()                              │ │ │
│  │  │     - requestAccessToken()                           │ │ │
│  │  │     - Get OAuth access token                         │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                            ↓                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  2. Fetch Subscriptions (Recursive)                  │ │ │
│  │  │     - fetchAllSubscriptions()                        │ │ │
│  │  │     - Do-while loop with pagination                  │ │ │
│  │  │     - Collect all subscription items                 │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                            ↓                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  3. Extract Channel IDs                              │ │ │
│  │  │     - Map subscriptions to channel IDs               │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                            ↓                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  4. Check localStorage Cache                         │ │ │
│  │  │     - getPlaylistCache()                             │ │ │
│  │  │     - Filter out cached IDs                          │ │ │
│  │  │     - Only fetch uncached channels                   │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                            ↓                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  5. Batch Processing (CRITICAL)                      │ │ │
│  │  │     - Split uncached IDs into groups of 50          │ │ │
│  │  │     - fetchChannelDetails() for each batch          │ │ │
│  │  │     - Extract uploads playlist ID                    │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                            ↓                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  6. Update Cache                                     │ │ │
│  │  │     - savePlaylistCache()                            │ │ │
│  │  │     - Store channelID → playlistID mapping          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                            ↓                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  7. Render UI                                        │ │ │
│  │  │     - createChannelCard() for each subscription     │ │ │
│  │  │     - Display in responsive grid                     │ │ │
│  │  │     - Show statistics                                │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
│                            ↓                                    │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    styles.css                              │ │
│  │  - Dark theme (YouTube-inspired)                           │ │
│  │  - CSS Grid responsive layout                              │ │
│  │  - Card hover effects                                      │ │
│  │  - Mobile/Tablet/Desktop breakpoints                       │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────┐  ┌────────────────────────┐ │
│  │  Google Identity Services    │  │  YouTube Data API v3   │ │
│  │  - OAuth 2.0 Token Model     │  │  - subscriptions.list  │ │
│  │  - Client-side auth          │  │  - channels.list       │ │
│  │  - No backend required       │  │  - Batched requests    │ │
│  └──────────────────────────────┘  └────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### First Load (No Cache)
```
User clicks "Sign in"
    ↓
Google OAuth (Token Model)
    ↓
Get access token
    ↓
Fetch subscriptions (recursive pagination)
    → 100 subscriptions = ~2 API calls
    ↓
Extract 100 channel IDs
    ↓
Check cache: 0 cached
    ↓
Batch into 2 groups of 50
    ↓
Call channels.list twice
    → 2 API calls
    ↓
Extract 100 playlist IDs
    ↓
Save to localStorage
    ↓
Render 100 cards in grid
    ↓
TOTAL: ~4 API calls
```

### Subsequent Loads (With Cache)
```
User clicks "Sign in"
    ↓
Google OAuth (Token Model)
    ↓
Get access token
    ↓
Fetch subscriptions (recursive pagination)
    → 100 subscriptions = ~2 API calls
    ↓
Extract 100 channel IDs
    ↓
Check cache: 100 cached
    ↓
No batching needed (all cached)
    → 0 API calls
    ↓
Load from localStorage
    ↓
Render 100 cards in grid
    ↓
TOTAL: ~2 API calls
```

### New Subscriptions (Partial Cache)
```
User clicks "Sign in"
    ↓
Google OAuth (Token Model)
    ↓
Get access token
    ↓
Fetch subscriptions (recursive pagination)
    → 110 subscriptions = ~3 API calls
    ↓
Extract 110 channel IDs
    ↓
Check cache: 100 cached, 10 uncached
    ↓
Batch 10 uncached into 1 group of 10
    ↓
Call channels.list once
    → 1 API call
    ↓
Extract 10 new playlist IDs
    ↓
Update localStorage
    ↓
Render 110 cards in grid
    ↓
TOTAL: ~4 API calls
```

## Quota Optimization

### Without Batching
```
100 subscriptions
  → 1 call to subscriptions.list (2 API calls for pagination)
  → 100 calls to channels.list (100 API calls)
TOTAL: 102 API units
```

### With Batching (This Implementation)
```
100 subscriptions
  → 1 call to subscriptions.list (2 API calls for pagination)
  → 2 batched calls to channels.list (2 API calls)
TOTAL: 4 API units
```

### With Batching + Cache (Subsequent)
```
100 subscriptions
  → 1 call to subscriptions.list (2 API calls for pagination)
  → 0 calls to channels.list (all cached)
TOTAL: 2 API units
```

**Savings: 96% reduction in API usage!**

## Error Handling Flow

```
API Call
    ↓
Status 401?
    ↓ Yes
    Show error: "Session expirée"
    ↓
    signOut()
    ↓
    Clear access token
    ↓
    Update UI (show sign-in button)
    ↓
    STOP
    
Status 401?
    ↓ No
    Other error?
        ↓ Yes
        Show error message
        ↓
        Continue (try next batch)
        
    Other error?
        ↓ No
        Process successful response
        ↓
        Continue flow
```

## Security Measures

```
User Data from API
    ↓
escapeHtml(data)
    ↓
Safe HTML entities
    ↓
Render to DOM
    
Channel/Playlist ID
    ↓
isValidYouTubeId(id)
    ↓
Valid? → Construct URL
Invalid? → Skip/Ignore
```

## File Structure

```
yt-dashboard/
├── index.html              # Entry point, HTML structure
├── app.js                  # Application logic (361 lines)
├── styles.css              # Responsive styles (240 lines)
├── CONFIG.md               # Setup instructions
├── README.md               # Project overview
├── config.example.js       # Configuration examples
├── UI-MOCKUP.md            # UI documentation
├── IMPLEMENTATION-SUMMARY.md # Complete summary
└── .gitignore              # Git ignore rules
```

## Browser Compatibility

- Modern browsers with ES6+ support
- Chrome 60+
- Firefox 60+
- Safari 12+
- Edge 79+

Required APIs:
- Fetch API
- localStorage
- Google Identity Services
- ES6 features (arrow functions, async/await, optional chaining)
