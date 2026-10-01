// Global Video Feed - entry point: authentication, loading and sync

import { CLIENT_ID, SCOPES, SYNC_INTERVAL_MS } from './config.js';
import {
    AuthError, fetchAllSubscriptions, fetchLatestVideos, fetchMyChannel, fetchUploadsPlaylists, fetchVideoDetails
} from './api.js';
import {
    applyVideoDetails, buildFeed, keepChannels, matchesSearch, mergeChannelVideos, videosMissingDetails
} from './feed.js';
import { openGroupsModal, setupGroupsModal } from './groups.js';
import {
    clearAccount, clearAuthData, getAccount, getAuthData, getCacheVersion, getChannelAvatars, getChannelNames,
    getGuideCollapsed, getLastSync, getPlaylistCache, getUserGroups, getVideoCache, hasStoredSession, saveAccount,
    saveAuthData, saveCacheVersion, saveChannelAvatars, saveChannelNames, saveGuideCollapsed, saveLastSync,
    savePlaylistCache, saveVideoCache
} from './storage.js';
import {
    clearUI, renderAccount, renderFilterButtons, renderStats, renderVideoGrid, setLoading, setSyncing,
    setupAccountMenu, showError, updateAuthUI
} from './ui.js';

const SECONDS_TO_MILLISECONDS = 1000;
const CACHE_VERSION = 2; // 2: videos come from long-form playlists (no Shorts)

let accessToken = null;
let tokenClient = null;
let isSyncing = false;
let activeGroup = null; // Group currently used to filter the feed (null = all)
let searchQuery = ''; // Text typed in the search box

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

    // Save with expiration timestamp
    saveAuthData({
        access_token: response.access_token,
        expires_in: response.expires_in,
        expires_at: Date.now() + (response.expires_in * SECONDS_TO_MILLISECONDS)
    });

    updateAuthUI(true);
    loadSubscriptions();
}

// Request access token
function requestAccessToken() {
    if (accessToken) {
        loadSubscriptions();
    } else if (tokenClient) {
        // Empty prompt: the consent screen is only shown the first time
        tokenClient.requestAccessToken({ prompt: '' });
    } else {
        showError('Le service Google n\'est pas encore chargé, réessayez dans un instant.');
    }
}

// Restore session from localStorage
function restoreSession() {
    if (!hasStoredSession()) {
        return; // No saved session
    }

    const authData = getAuthData();

    // Invalid data structure, clean up
    if (!isValidAuthData(authData)) {
        clearAuthData();
        return;
    }

    // Token is still valid, restore session
    if (Date.now() < authData.expires_at) {
        accessToken = authData.access_token;
        updateAuthUI(true);
        loadSubscriptions();
    }
    // An expired token is kept: it marks that the user did not sign out,
    // so the cached feed stays visible until they reconnect
}

// Sign out
function signOut() {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            console.log('Access token revoked');
        });
        accessToken = null;
        clearAuthData();
        clearAccount();

        updateAuthUI(false);
        clearUI();
    }
}

// Handle an expired or revoked access token: keep the cached feed visible
function handleSessionExpired() {
    accessToken = null;
    updateAuthUI(false);
    showError('Session expirée. Reconnectez-vous pour mettre à jour le flux.');
}

// Save the video cache, warning the user if the browser storage is full
function storeVideoCache(cache) {
    if (!saveVideoCache(cache)) {
        showError('Impossible d\'enregistrer le cache des vidéos (stockage du navigateur plein)');
    }
}

// Older caches may hold Shorts or full API items: drop them so the next sync rebuilds them
function upgradeVideoCache() {
    if (getCacheVersion() >= CACHE_VERSION) return;

    storeVideoCache({});
    saveLastSync(0);
    saveCacheVersion(CACHE_VERSION);
}

// Forget channels the user is no longer subscribed to
function pruneUnsubscribedChannels(channelIds) {
    savePlaylistCache(keepChannels(getPlaylistCache(), channelIds));
    storeVideoCache(keepChannels(getVideoCache(), channelIds));
}

// Fetch the uploads playlist of channels not in the cache yet
async function updatePlaylistCache(channelIds) {
    const cache = getPlaylistCache();
    const uncachedIds = channelIds.filter(id => !cache[id]);

    if (uncachedIds.length === 0) {
        return;
    }

    const playlists = await fetchUploadsPlaylists(uncachedIds, accessToken);
    savePlaylistCache({ ...cache, ...playlists });
}

// Smart Sync: Fetch videos from all channels
async function syncAllChannels(force = false) {
    if (isSyncing) {
        console.log('Sync skipped: already in progress');
        return;
    }

    // Check if sync is needed
    const now = Date.now();

    if (!force && (now - getLastSync()) < SYNC_INTERVAL_MS) {
        console.log('Sync skipped: last sync was too recent');
        return;
    }

    // Get playlist cache as [channelId, playlistId] pairs
    const channels = Object.entries(getPlaylistCache());

    if (channels.length === 0) {
        console.log('No playlists to sync');
        return;
    }

    setLoading(true, 'Mise à jour du flux...');
    setSyncing(true);
    isSyncing = true;

    try {
        // Fetch videos from all playlists in parallel
        const results = await Promise.all(
            channels.map(([, playlistId]) => fetchLatestVideos(playlistId, accessToken))
        );

        // Every request failed: keep the previous timestamp so the next load retries
        if (results.every(videos => videos === null)) {
            showError('Erreur lors de la synchronisation des vidéos');
            return;
        }

        // Merge results into cache
        const videoCache = getVideoCache();
        results.forEach((videos, index) => {
            if (!videos || videos.length === 0) return;

            const [channelId] = channels[index];
            videoCache[channelId] = mergeChannelVideos(videos, videoCache[channelId]);
        });

        // Durations and view counts: refresh the videos just fetched (recent, views still
        // moving) and fill in any cached video that has none yet
        const fetchedIds = results.filter(Boolean).flat().map(item => item.snippet?.resourceId?.videoId);
        const detailIds = [...new Set([...fetchedIds, ...videosMissingDetails(videoCache)])].filter(Boolean);
        const details = await fetchVideoDetails(detailIds, accessToken);

        // Save updated cache and timestamp
        storeVideoCache(applyVideoDetails(videoCache, details));
        saveLastSync(now);

        console.log('Sync completed successfully');

        renderVideoFeed();
        refreshFilterButtons();

    } catch (error) {
        if (error instanceof AuthError) {
            handleSessionExpired();
        } else {
            console.error('Error during sync:', error);
            showError('Erreur lors de la synchronisation des vidéos');
        }
    } finally {
        isSyncing = false;
        setSyncing(false);
        setLoading(false);
    }
}

// Load and display subscriptions
async function loadSubscriptions() {
    setLoading(true);
    clearUI();
    let loaded = false;

    try {
        // First, load videos from cache immediately
        renderVideoFeed();

        // Fetch all subscriptions, and the user's name and avatar for the masthead
        const [subscriptions, account] = await Promise.all([
            fetchAllSubscriptions(accessToken),
            fetchMyChannel(accessToken)
        ]);
        if (account) {
            saveAccount(account);
            renderAccount(account);
        }

        if (subscriptions.length === 0) {
            showError('Aucun abonnement trouvé.');
            return;
        }

        // Extract channel IDs and save channel names and avatars
        const channelIds = subscriptions.map(sub => sub.snippet.resourceId.channelId);
        const channelNames = {};
        const channelAvatars = {};
        subscriptions.forEach(sub => {
            const channelId = sub.snippet.resourceId.channelId;
            channelNames[channelId] = sub.snippet.title;
            channelAvatars[channelId] = sub.snippet.thumbnails?.default?.url || '';
        });
        saveChannelNames(channelNames);
        saveChannelAvatars(channelAvatars);
        pruneUnsubscribedChannels(channelIds);
        renderVideoFeed();

        // Fetch channel details in batches
        await updatePlaylistCache(channelIds);

        refreshFilterButtons();
        loaded = true;

    } catch (error) {
        if (error instanceof AuthError) {
            handleSessionExpired();
        } else {
            showError(`Erreur lors de la récupération des abonnements: ${error.message}`);
        }
    } finally {
        setLoading(false);
    }

    // Trigger smart sync in background (non-blocking)
    if (loaded) {
        syncAllChannels(false);
    }
}

// Render video feed, filtered by the active group and the search box
function renderVideoFeed() {
    const channelIds = activeGroup ? (getUserGroups()[activeGroup] || []) : null;
    const videos = buildFeed(getVideoCache(), channelIds).filter(video => matchesSearch(video, searchQuery));

    renderStats(Object.keys(getChannelNames()).length, videos.length);

    let emptyMessage;
    if (searchQuery.trim()) {
        emptyMessage = `Aucune vidéo ne correspond à « ${searchQuery.trim()} ».`;
    } else if (accessToken) {
        emptyMessage = "Aucune vidéo disponible. Cliquez sur l'icône de synchronisation pour récupérer les dernières vidéos.";
    } else {
        emptyMessage = 'Aucune vidéo disponible. Connectez-vous pour récupérer les dernières vidéos.';
    }
    renderVideoGrid(videos, emptyMessage, getChannelAvatars());
}

// Render the filter buttons for the current groups
function refreshFilterButtons() {
    renderFilterButtons(Object.keys(getUserGroups()), activeGroup, groupName => {
        activeGroup = groupName;
        renderVideoFeed();
    });
}

// Show the cached feed without calling the API
function showCachedFeed() {
    refreshFilterButtons();
    renderVideoFeed();
}

// Initialize application
function initApp() {
    upgradeVideoCache();
    setupEventListeners();

    // Show the cached feed right away, unless the user signed out
    if (hasStoredSession()) {
        renderAccount(getAccount());
        showCachedFeed();
    }

    waitForGoogleAuth();
}

// Wait for Google Identity Services to load, then restore the session
function waitForGoogleAuth() {
    if (typeof google !== 'undefined' && google.accounts) {
        initializeGoogleAuth();

        // Try to restore session from localStorage
        restoreSession();
    } else {
        setTimeout(waitForGoogleAuth, 100);
    }
}

// Setup button event listeners
function setupEventListeners() {
    document.getElementById('signout-button')?.addEventListener('click', signOut);
    document.getElementById('authorize-button')?.addEventListener('click', requestAccessToken);
    document.getElementById('force-sync-button')?.addEventListener('click', () => syncAllChannels(true));
    document.getElementById('manage-groups-button')?.addEventListener('click', openGroupsModal);
    setupAccountMenu();

    // Menu button: collapse / expand the left navigation (remembered)
    document.body.classList.toggle('guide-collapsed', getGuideCollapsed());
    document.getElementById('guide-button')?.addEventListener('click', () => {
        saveGuideCollapsed(document.body.classList.toggle('guide-collapsed'));
    });

    // Search filters the feed as you type
    const searchInput = document.getElementById('search-input');
    searchInput?.addEventListener('input', () => {
        searchQuery = searchInput.value;
        renderVideoFeed();
    });
    document.getElementById('search-form')?.addEventListener('submit', event => {
        event.preventDefault();
        searchInput?.blur();
    });

    setupGroupsModal(refreshFilterButtons);
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
