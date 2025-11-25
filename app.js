// YouTube Dashboard Application
// Google Identity Services (Token Model) - No backend secret required

const API_KEY = 'AIzaSyBjfBblUeW8XnRVLIQA1oK-btKUVXh0hOQ'; // Replace with your YouTube Data API key
const CLIENT_ID = '595852680736-bde0rog3cine1u63lh1k3q53u1l5orlv.apps.googleusercontent.com'; // Replace with your OAuth Client ID
const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';
const BATCH_SIZE = 50;
const STORAGE_KEY = 'yt_playlist_cache';
const AUTH_STORAGE_KEY = 'yt_auth_token';
const VIDEO_CACHE_KEY = 'yt_video_cache';
const LAST_SYNC_KEY = 'yt_last_sync';
const USER_GROUPS_KEY = 'yt_user_groups';
const CHANNEL_NAMES_KEY = 'yt_channel_names';
const SECONDS_TO_MILLISECONDS = 1000;
const ONE_HOUR_MS = 3600000;
const MAX_VIDEOS_PER_CHANNEL = 10;

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

// Validate auth data structure
function isValidAuthData(authData) {
    return authData && 
           typeof authData === 'object' && 
           typeof authData.access_token === 'string' &&
           authData.access_token.length > 0 &&
           typeof authData.expires_at === 'number' &&
           authData.expires_at > 0;
}

// Handle authentication response
function handleAuthResponse(response) {
    if (response.error !== undefined) {
        showError(`Erreur d'authentification: ${response.error}`);
        return;
    }
    
    // Validate expires_in
    if (!response.expires_in || response.expires_in <= 0) {
        showError('Réponse d\'authentification invalide');
        return;
    }
    
    accessToken = response.access_token;
    
    // Save to localStorage with expiration timestamp
    try {
        const expiresAt = Date.now() + (response.expires_in * SECONDS_TO_MILLISECONDS);
        const authData = {
            access_token: response.access_token,
            expires_in: response.expires_in,
            expires_at: expiresAt
        };
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
    } catch (error) {
        console.error('Error saving auth token to localStorage:', error);
    }
    
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

// Restore session from localStorage
function restoreSession() {
    try {
        const authDataStr = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!authDataStr) {
            return; // No saved session
        }
        
        const authData = JSON.parse(authDataStr);
        
        // Validate authData structure
        if (!isValidAuthData(authData)) {
            // Invalid data structure, clean up
            localStorage.removeItem(AUTH_STORAGE_KEY);
            return;
        }
        
        const now = Date.now();
        
        // Check if token is still valid
        if (now < authData.expires_at) {
            // Token is still valid, restore session
            accessToken = authData.access_token;
            updateAuthUI(true);
            loadSubscriptions();
        } else {
            // Token is expired, clean up
            localStorage.removeItem(AUTH_STORAGE_KEY);
            accessToken = null;
        }
    } catch (error) {
        console.error('Error restoring session:', error);
        // Clean up on error
        localStorage.removeItem(AUTH_STORAGE_KEY);
        accessToken = null;
    }
}

// Sign out
function signOut() {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            console.log('Access token revoked');
        });
        accessToken = null;
        
        // Remove from localStorage
        localStorage.removeItem(AUTH_STORAGE_KEY);
        
        updateAuthUI(false);
        clearUI();
    }
}

// Update authentication UI
function updateAuthUI(isAuthenticated) {
    const authButton = document.getElementById('authorize-button');
    const signOutButton = document.getElementById('signout-button');
    const forceSyncButton = document.getElementById('force-sync-button');
    const manageGroupsButton = document.getElementById('manage-groups-button');
    const filtersBar = document.getElementById('filters-bar');
    
    if (authButton) {
        // Si connecté, on cache le bouton de connexion, sinon on l'affiche
        authButton.style.display = isAuthenticated ? 'none' : 'inline-block';
    }
    if (signOutButton) {
        // Inversement pour le bouton de déconnexion
        signOutButton.style.display = isAuthenticated ? 'inline-block' : 'none';
    }
    if (forceSyncButton) {
        forceSyncButton.style.display = isAuthenticated ? 'inline-block' : 'none';
    }
    if (manageGroupsButton) {
        manageGroupsButton.style.display = isAuthenticated ? 'inline-block' : 'none';
    }
    if (filtersBar) {
        filtersBar.style.display = isAuthenticated ? 'block' : 'none';
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

// Get video cache from localStorage
function getVideoCache() {
    try {
        const cache = localStorage.getItem(VIDEO_CACHE_KEY);
        return cache ? JSON.parse(cache) : {};
    } catch (error) {
        console.error('Error reading video cache:', error);
        return {};
    }
}

// Save video cache to localStorage
function saveVideoCache(cache) {
    try {
        localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.error('Error saving video cache:', error);
    }
}

// Get last sync timestamp
function getLastSync() {
    try {
        const lastSync = localStorage.getItem(LAST_SYNC_KEY);
        return lastSync ? parseInt(lastSync, 10) : 0;
    } catch (error) {
        console.error('Error reading last sync:', error);
        return 0;
    }
}

// Save last sync timestamp
function saveLastSync(timestamp) {
    try {
        localStorage.setItem(LAST_SYNC_KEY, timestamp.toString());
    } catch (error) {
        console.error('Error saving last sync:', error);
    }
}

// Get user groups from localStorage
function getUserGroups() {
    try {
        const groups = localStorage.getItem(USER_GROUPS_KEY);
        return groups ? JSON.parse(groups) : {};
    } catch (error) {
        console.error('Error reading user groups:', error);
        return {};
    }
}

// Save user groups to localStorage
function saveUserGroups(groups) {
    try {
        localStorage.setItem(USER_GROUPS_KEY, JSON.stringify(groups));
    } catch (error) {
        console.error('Error saving user groups:', error);
    }
}

// Get channel names from localStorage
function getChannelNames() {
    try {
        const names = localStorage.getItem(CHANNEL_NAMES_KEY);
        return names ? JSON.parse(names) : {};
    } catch (error) {
        console.error('Error reading channel names:', error);
        return {};
    }
}

// Save channel names to localStorage
function saveChannelNames(names) {
    try {
        localStorage.setItem(CHANNEL_NAMES_KEY, JSON.stringify(names));
    } catch (error) {
        console.error('Error saving channel names:', error);
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

// Smart Sync: Fetch videos from all channels
async function syncAllChannels(force = false) {
    // Check if sync is needed
    const lastSync = getLastSync();
    const now = Date.now();
    
    if (!force && (now - lastSync) < ONE_HOUR_MS) {
        console.log('Sync skipped: last sync was less than 1 hour ago');
        return;
    }
    
    // Get playlist cache
    const playlistCache = getPlaylistCache();
    const playlistIds = Object.values(playlistCache);
    
    if (playlistIds.length === 0) {
        console.log('No playlists to sync');
        return;
    }
    
    // Show sync indicator
    const loadingEl = document.getElementById('loading');
    const loadingText = loadingEl?.querySelector('p');
    if (loadingText) {
        loadingText.textContent = 'Mise à jour du flux...';
    }
    setLoading(true);
    
    try {
        // Fetch videos from all playlists in parallel
        const videoPromises = playlistIds.map(playlistId => 
            fetchPlaylistVideos(playlistId)
        );
        
        const results = await Promise.all(videoPromises);
        
        // Get current video cache
        const videoCache = getVideoCache();
        
        // Merge results into cache
        results.forEach((videos, index) => {
            if (!videos || videos.length === 0) return;
            
            // Find the channel ID for this playlist
            const channelId = Object.keys(playlistCache).find(
                key => playlistCache[key] === playlistIds[index]
            );
            
            if (!channelId) return;
            
            // Get existing videos for this channel
            const existingVideos = videoCache[channelId] || [];
            const existingVideoIds = new Set(
                existingVideos.map(v => v.snippet?.resourceId?.videoId)
            );
            
            // Add new videos
            const newVideos = videos.filter(
                v => !existingVideoIds.has(v.snippet?.resourceId?.videoId)
            );
            
            // Combine and keep max 10 videos
            const combined = [...newVideos, ...existingVideos];
            videoCache[channelId] = combined.slice(0, MAX_VIDEOS_PER_CHANNEL);
        });
        
        // Save updated cache and timestamp
        saveVideoCache(videoCache);
        saveLastSync(now);
        
        console.log('Sync completed successfully');
        
        // Reload the video feed
        renderVideoFeed();
        
        // Update filter buttons in case videos changed
        renderFilterButtons();
        
    } catch (error) {
        console.error('Error during sync:', error);
        showError('Erreur lors de la synchronisation des vidéos');
    } finally {
        setLoading(false);
        if (loadingText) {
            loadingText.textContent = 'Chargement des abonnements...';
        }
    }
}

// Fetch videos from a single playlist
async function fetchPlaylistVideos(playlistId) {
    try {
        const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
        url.searchParams.append('part', 'snippet');
        url.searchParams.append('playlistId', playlistId);
        url.searchParams.append('maxResults', '5');
        url.searchParams.append('key', API_KEY);
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        if (response.status === 401) {
            // Token expired, will be handled by main flow
            return [];
        }
        
        if (!response.ok) {
            console.error(`Error fetching playlist ${playlistId}: ${response.status}`);
            return [];
        }
        
        const data = await response.json();
        return data.items || [];
        
    } catch (error) {
        console.error(`Error fetching playlist ${playlistId}:`, error);
        return [];
    }
}

// Format relative time
function getRelativeTime(dateString) {
    const now = Date.now();
    const published = new Date(dateString).getTime();
    const diff = now - published;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    
    if (years > 0) return `il y a ${years} an${years > 1 ? 's' : ''}`;
    if (months > 0) return `il y a ${months} mois`;
    if (days > 0) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
    if (hours > 0) return `il y a ${hours}h`;
    if (minutes > 0) return `il y a ${minutes}min`;
    return 'à l\'instant';
}

// Render video feed
function renderVideoFeed(filterGroup = null) {
    const videoCache = getVideoCache();
    const playlistCache = getPlaylistCache();
    
    // Flatten all videos with channel info
    const allVideos = [];
    
    Object.keys(videoCache).forEach(channelId => {
        const videos = videoCache[channelId] || [];
        videos.forEach(video => {
            allVideos.push({
                ...video,
                channelId: channelId
            });
        });
    });
    
    // Filter by group if specified
    let filteredVideos = allVideos;
    if (filterGroup) {
        const groups = getUserGroups();
        const channelIds = groups[filterGroup] || [];
        filteredVideos = allVideos.filter(v => channelIds.includes(v.channelId));
    }
    
    // Sort by published date (descending)
    filteredVideos.sort((a, b) => {
        const dateA = new Date(a.snippet?.publishedAt || 0).getTime();
        const dateB = new Date(b.snippet?.publishedAt || 0).getTime();
        return dateB - dateA;
    });
    
    // Render videos
    const grid = document.getElementById('subscriptions-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (filteredVideos.length === 0) {
        grid.innerHTML = '<div class="no-videos">Aucune vidéo disponible. Cliquez sur "Forcer la synchro" pour récupérer les dernières vidéos.</div>';
        return;
    }
    
    filteredVideos.forEach(video => {
        const card = createVideoCard(video);
        grid.appendChild(card);
    });
    
    // Update stats
    const statsEl = document.getElementById('stats');
    const videoCountEl = document.getElementById('video-count');
    if (statsEl) statsEl.style.display = 'flex';
    if (videoCountEl) videoCountEl.textContent = filteredVideos.length;
}

// Create video card element
function createVideoCard(video) {
    const videoId = video.snippet?.resourceId?.videoId;
    const title = video.snippet?.title || 'Sans titre';
    const channelTitle = video.snippet?.channelTitle || 'Chaîne inconnue';
    const publishedAt = video.snippet?.publishedAt;
    const thumbnail = video.snippet?.thumbnails?.medium?.url || 
                      video.snippet?.thumbnails?.default?.url || '';
    
    const card = document.createElement('div');
    card.className = 'video-card';
    
    if (videoId && isValidYouTubeId(videoId)) {
        card.onclick = () => {
            window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
        };
    }
    
    card.innerHTML = `
        <img class="video-thumbnail" src="${escapeHtml(thumbnail)}" alt="${escapeHtml(title)}" loading="lazy">
        <div class="video-info">
            <div class="video-title">${escapeHtml(title)}</div>
            <div class="video-channel">${escapeHtml(channelTitle)}</div>
            <div class="video-date">${getRelativeTime(publishedAt)}</div>
        </div>
    `;
    
    return card;
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
function updateStats(subscriptionCount, videoCount) {
    const statsEl = document.getElementById('stats');
    const subCountEl = document.getElementById('sub-count');
    const videoCountEl = document.getElementById('video-count');
    
    if (statsEl) statsEl.style.display = 'flex';
    if (subCountEl) subCountEl.textContent = subscriptionCount;
    if (videoCountEl) videoCountEl.textContent = videoCount;
}

// Load and display subscriptions
async function loadSubscriptions() {
    setLoading(true);
    clearUI();
    
    try {
        // First, load videos from cache immediately
        renderVideoFeed();
        
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
        
        // Extract channel IDs and save channel names
        const channelIds = subscriptions.map(sub => sub.snippet.resourceId.channelId);
        const channelNames = {};
        subscriptions.forEach(sub => {
            const channelId = sub.snippet.resourceId.channelId;
            channelNames[channelId] = sub.snippet.title;
        });
        saveChannelNames(channelNames);
        
        // Fetch channel details in batches
        const playlistCache = await fetchChannelDetails(channelIds);
        
        // Update statistics
        const videoCache = getVideoCache();
        const videoCount = Object.values(videoCache).reduce((sum, videos) => sum + videos.length, 0);
        updateStats(subscriptions.length, videoCount);
        
        // Initialize filter buttons
        renderFilterButtons();
        
        // Trigger smart sync (non-blocking)
        setLoading(false);
        syncAllChannels(false);
        
    } catch (error) {
        showError(`Erreur: ${error.message}`);
        setLoading(false);
    }
}

// Initialize application
function initApp() {
    // Wait for Google Identity Services to load
    if (typeof google !== 'undefined' && google.accounts) {
        initializeGoogleAuth();
        
        // Try to restore session from localStorage
        restoreSession();
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
    
    // Setup force sync button
    const forceSyncButton = document.getElementById('force-sync-button');
    if (forceSyncButton) {
        forceSyncButton.addEventListener('click', () => {
            syncAllChannels(true);
        });
    }
    
    // Setup manage groups button
    const manageGroupsButton = document.getElementById('manage-groups-button');
    if (manageGroupsButton) {
        manageGroupsButton.addEventListener('click', openGroupsModal);
    }
    
    // Setup close modal button
    const closeModalButton = document.getElementById('close-modal');
    if (closeModalButton) {
        closeModalButton.addEventListener('click', closeGroupsModal);
    }
    
    // Setup save group button
    const saveGroupButton = document.getElementById('save-group');
    if (saveGroupButton) {
        saveGroupButton.addEventListener('click', saveNewGroup);
    }
}

// Render filter buttons
function renderFilterButtons() {
    const filterContainer = document.getElementById('filter-buttons');
    if (!filterContainer) return;
    
    filterContainer.innerHTML = '';
    
    // "All" button
    const allButton = document.createElement('button');
    allButton.className = 'filter-button active';
    allButton.textContent = 'Tous';
    allButton.onclick = () => {
        setActiveFilter(allButton);
        renderVideoFeed(null);
    };
    filterContainer.appendChild(allButton);
    
    // Group buttons
    const groups = getUserGroups();
    Object.keys(groups).forEach(groupName => {
        const button = document.createElement('button');
        button.className = 'filter-button';
        button.textContent = groupName;
        button.onclick = () => {
            setActiveFilter(button);
            renderVideoFeed(groupName);
        };
        filterContainer.appendChild(button);
    });
}

// Set active filter button
function setActiveFilter(activeButton) {
    const buttons = document.querySelectorAll('.filter-button');
    buttons.forEach(btn => btn.classList.remove('active'));
    activeButton.classList.add('active');
}

// Open groups modal
function openGroupsModal() {
    const modal = document.getElementById('groups-modal');
    if (modal) {
        modal.style.display = 'flex';
        populateChannelList();
    }
}

// Close groups modal
function closeGroupsModal() {
    const modal = document.getElementById('groups-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Populate channel list in modal
function populateChannelList() {
    const channelListEl = document.getElementById('channel-list');
    if (!channelListEl) return;
    
    channelListEl.innerHTML = '';
    
    const playlistCache = getPlaylistCache();
    const channelNames = getChannelNames();
    const channelIds = Object.keys(playlistCache);
    
    if (channelIds.length === 0) {
        channelListEl.innerHTML = '<p class="no-channels">Aucune chaîne disponible</p>';
        return;
    }
    
    // Sort by channel name
    channelIds.sort((a, b) => {
        const nameA = channelNames[a] || a;
        const nameB = channelNames[b] || b;
        return nameA.localeCompare(nameB);
    });
    
    channelIds.forEach(channelId => {
        const label = document.createElement('label');
        label.className = 'channel-checkbox';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = channelId;
        checkbox.dataset.channelId = channelId;
        
        const span = document.createElement('span');
        span.textContent = channelNames[channelId] || channelId;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        channelListEl.appendChild(label);
    });
}

// Save new group
function saveNewGroup() {
    const groupNameInput = document.getElementById('group-name');
    const channelCheckboxes = document.querySelectorAll('#channel-list input[type="checkbox"]:checked');
    
    if (!groupNameInput) return;
    
    const groupName = groupNameInput.value.trim();
    
    if (!groupName) {
        showError('Veuillez entrer un nom de groupe');
        return;
    }
    
    const selectedChannels = Array.from(channelCheckboxes).map(cb => cb.value);
    
    if (selectedChannels.length === 0) {
        showError('Veuillez sélectionner au moins une chaîne');
        return;
    }
    
    // Save group
    const groups = getUserGroups();
    groups[groupName] = selectedChannels;
    saveUserGroups(groups);
    
    // Reset form
    groupNameInput.value = '';
    channelCheckboxes.forEach(cb => cb.checked = false);
    
    // Update filter buttons
    renderFilterButtons();
    
    // Close modal
    closeGroupsModal();
    
    console.log(`Group "${groupName}" created with ${selectedChannels.length} channels`);
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
