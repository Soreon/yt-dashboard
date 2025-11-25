// YouTube Dashboard Application
// Google Identity Services (Token Model) - No backend secret required

const API_KEY = 'AIzaSyBjfBblUeW8XnRVLIQA1oK-btKUVXh0hOQ'; // Replace with your YouTube Data API key
const CLIENT_ID = '595852680736-bde0rog3cine1u63lh1k3q53u1l5orlv.apps.googleusercontent.com'; // Replace with your OAuth Client ID
const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';
const BATCH_SIZE = 50;
const STORAGE_KEY = 'yt_playlist_cache';

let accessToken = null;
let tokenClient = null;

// Initialize Google Identity Services
function initializeGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: handleAuthResponse,
    });
}

// Handle authentication response
function handleAuthResponse(response) {
    if (response.error !== undefined) {
        showError(`Erreur d'authentification: ${response.error}`);
        return;
    }
    
    accessToken = response.access_token;
    updateAuthUI(true);
    loadSubscriptions();
}

// Global callback for button sign-in
window.handleCredentialResponse = function(response) {
    // This is for the One Tap sign-in, but we're using token model
    console.log('Credential response received');
};

// Request access token
function requestAccessToken() {
    if (accessToken) {
        loadSubscriptions();
    } else {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    }
}

// Sign out
function signOut() {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            console.log('Access token revoked');
        });
        accessToken = null;
        updateAuthUI(false);
        clearUI();
    }
}

// Update authentication UI
function updateAuthUI(isAuthenticated) {
    const signInButton = document.querySelector('.g_id_signin');
    const signOutButton = document.getElementById('signout-button');
    
    if (signInButton) {
        signInButton.style.display = isAuthenticated ? 'none' : 'block';
    }
    if (signOutButton) {
        signOutButton.style.display = isAuthenticated ? 'block' : 'none';
    }
}

// Show/hide loading indicator
function setLoading(isLoading) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.style.display = isLoading ? 'flex' : 'none';
    }
}

// Show error message
function showError(message) {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 5000);
    }
    console.error(message);
}

// Clear UI
function clearUI() {
    const grid = document.getElementById('subscriptions-grid');
    const stats = document.getElementById('stats');
    if (grid) grid.innerHTML = '';
    if (stats) stats.style.display = 'none';
}

// Fetch all subscriptions recursively
async function fetchAllSubscriptions() {
    const allSubscriptions = [];
    let nextPageToken = null;
    
    do {
        try {
            const url = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
            url.searchParams.append('part', 'snippet');
            url.searchParams.append('mine', 'true');
            url.searchParams.append('maxResults', '50');
            url.searchParams.append('order', 'alphabetical');
            if (nextPageToken) {
                url.searchParams.append('pageToken', nextPageToken);
            }
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            if (response.status === 401) {
                showError('Session expirée. Veuillez vous reconnecter.');
                signOut();
                return null;
            }
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            allSubscriptions.push(...(data.items || []));
            nextPageToken = data.nextPageToken;
            
        } catch (error) {
            showError(`Erreur lors de la récupération des abonnements: ${error.message}`);
            return null;
        }
    } while (nextPageToken);
    
    return allSubscriptions;
}

// Get playlist cache from localStorage
function getPlaylistCache() {
    try {
        const cache = localStorage.getItem(STORAGE_KEY);
        return cache ? JSON.parse(cache) : {};
    } catch (error) {
        console.error('Error reading cache:', error);
        return {};
    }
}

// Save playlist cache to localStorage
function savePlaylistCache(cache) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.error('Error saving cache:', error);
    }
}

// Batch fetch channel details to get uploads playlist IDs
async function fetchChannelDetails(channelIds) {
    const cache = getPlaylistCache();
    const uncachedIds = channelIds.filter(id => !cache[id]);
    
    if (uncachedIds.length === 0) {
        return cache;
    }
    
    // Split into batches of 50
    const batches = [];
    for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
        batches.push(uncachedIds.slice(i, i + BATCH_SIZE));
    }
    
    // Fetch each batch
    for (const batch of batches) {
        try {
            const url = new URL('https://www.googleapis.com/youtube/v3/channels');
            url.searchParams.append('part', 'contentDetails');
            url.searchParams.append('id', batch.join(','));
            url.searchParams.append('key', API_KEY);
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            if (response.status === 401) {
                showError('Session expirée. Veuillez vous reconnecter.');
                signOut();
                return cache;
            }
            
            if (!response.ok) {
                console.error(`Batch fetch error: ${response.status}`);
                continue;
            }
            
            const data = await response.json();
            
            // Update cache with new data
            if (data.items) {
                data.items.forEach(channel => {
                    const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
                    if (playlistId) {
                        cache[channel.id] = playlistId;
                    }
                });
            }
        } catch (error) {
            console.error('Error fetching batch:', error);
        }
    }
    
    // Save updated cache
    savePlaylistCache(cache);
    return cache;
}

// Validate YouTube ID format (alphanumeric, underscore, hyphen)
function isValidYouTubeId(id) {
    return id && /^[a-zA-Z0-9_-]+$/.test(id);
}

// Create channel card element
function createChannelCard(subscription, playlistCache) {
    const channelId = subscription.snippet.resourceId.channelId;
    const playlistId = playlistCache[channelId];
    const isCached = playlistCache.hasOwnProperty(channelId);
    
    const card = document.createElement('div');
    card.className = 'channel-card';
    card.onclick = () => {
        if (playlistId && isValidYouTubeId(playlistId)) {
            window.open(`https://www.youtube.com/playlist?list=${playlistId}`, '_blank');
        } else if (isValidYouTubeId(channelId)) {
            window.open(`https://www.youtube.com/channel/${channelId}`, '_blank');
        }
    };
    
    const thumbnail = subscription.snippet.thumbnails?.medium?.url || 
                      subscription.snippet.thumbnails?.default?.url || '';
    const avatar = subscription.snippet.thumbnails?.default?.url || '';
    const title = subscription.snippet.title || 'Unknown Channel';
    
    card.innerHTML = `
        <img class="channel-thumbnail" src="${escapeHtml(thumbnail)}" alt="${escapeHtml(title)}" loading="lazy">
        <div class="channel-info">
            <img class="channel-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(title)}" loading="lazy">
            <div class="channel-details">
                <div class="channel-title">${escapeHtml(title)}</div>
            </div>
        </div>
        <div class="channel-meta">
            ${playlistId ? `<span class="playlist-indicator ${isCached ? 'cached' : ''}">
                ${isCached ? '✓ Cached' : 'Playlist ID'}
            </span>` : ''}
        </div>
    `;
    
    return card;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update statistics display
function updateStats(subscriptionCount, cacheCount) {
    const statsEl = document.getElementById('stats');
    const subCountEl = document.getElementById('sub-count');
    const cacheCountEl = document.getElementById('cache-count');
    
    if (statsEl) statsEl.style.display = 'flex';
    if (subCountEl) subCountEl.textContent = subscriptionCount;
    if (cacheCountEl) cacheCountEl.textContent = cacheCount;
}

// Load and display subscriptions
async function loadSubscriptions() {
    setLoading(true);
    clearUI();
    
    try {
        // Fetch all subscriptions
        const subscriptions = await fetchAllSubscriptions();
        
        if (!subscriptions) {
            setLoading(false);
            return;
        }
        
        if (subscriptions.length === 0) {
            showError('Aucun abonnement trouvé.');
            setLoading(false);
            return;
        }
        
        // Extract channel IDs
        const channelIds = subscriptions.map(sub => sub.snippet.resourceId.channelId);
        
        // Fetch channel details in batches
        const playlistCache = await fetchChannelDetails(channelIds);
        
        // Display subscriptions
        const grid = document.getElementById('subscriptions-grid');
        if (grid) {
            subscriptions.forEach(subscription => {
                const card = createChannelCard(subscription, playlistCache);
                grid.appendChild(card);
            });
        }
        
        // Update statistics
        updateStats(subscriptions.length, Object.keys(playlistCache).length);
        
    } catch (error) {
        showError(`Erreur: ${error.message}`);
    } finally {
        setLoading(false);
    }
}

// Initialize application
function initApp() {
    // Wait for Google Identity Services to load
    if (typeof google !== 'undefined' && google.accounts) {
        initializeGoogleAuth();
    } else {
        setTimeout(initApp, 100);
    }
    
    // Setup sign out button
    const signOutButton = document.getElementById('signout-button');
    if (signOutButton) {
        signOutButton.addEventListener('click', signOut);
    }
    
    // Setup sign in button click handler
    const authButton = document.getElementById('authorize-button');
    if (authButton) {
        authButton.addEventListener('click', () => {
            requestAccessToken();
        });
    }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
