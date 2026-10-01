// Global Video Feed - entry point: authentication, loading and sync

import { AUTO_SYNC_CHECK_MS, CLIENT_ID, SCOPES, SYNC_INTERVAL_MS } from './config.js';
import {
    AuthError, fetchAllSubscriptions, fetchLatestVideos, fetchMyChannel, fetchUploadsPlaylists, fetchVideoDetails
} from './api.js';
import {
    applyVideoDetails, buildFeed, keepChannels, matchesSearch, mergeChannelVideos, videosMissingDetails
} from './feed.js';
import { groupsRouteFromHash, renderGroupsPage, setupGroupsPage } from './groups.js';
import {
    groupByDay, historyEntries, importWatches, markWatched, parseTakeoutHistory, unmarkWatched
} from './history-model.js';
import {
    clearAccount, clearAuthData, getAccount, getAuthData, getCacheVersion, getChannelAvatars, getChannelNames,
    getGuideCollapsed, getHiddenGroups, getLastSync, getPlaylistCache, getUserGroups, getVideoCache, getWatchHistory,
    hasStoredSession,
    saveAccount, saveAuthData, saveCacheVersion, saveChannelAvatars, saveChannelNames, saveGuideCollapsed,
    saveLastSync, savePlaylistCache, saveVideoCache, saveWatchHistory
} from './storage.js';
import {
    clearUI, hideNewVideosPill, markCardWatched, renderAccount, renderFilterButtons, renderHistory, renderStats,
    renderVideoGrid, setActiveView, setLoading, setSyncing, setupAccountMenu, showError, showNewVideosPill, showToast,
    updateAuthUI
} from './ui.js';

const SECONDS_TO_MILLISECONDS = 1000;
const CACHE_VERSION = 2; // 2: videos come from long-form playlists (no Shorts)
const SCROLLED_DOWN_PX = 200; // Below this scroll, new videos are shown right away

let accessToken = null;
let tokenExpiresAt = 0;
let tokenClient = null;
let isSyncing = false;
let activeGroup = null; // Group currently used to filter the feed (null = all)
let activeChannel = null; // Channel the feed is filtered on, from the groups page: { id, name } or null
let searchQuery = ''; // Text typed in the search box
let currentView = 'feed'; // 'feed', 'groups' or 'history'
let watchedSinceRender = false; // Videos opened since the last render, hidden when coming back

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
    tokenExpiresAt = Date.now() + (response.expires_in * SECONDS_TO_MILLISECONDS);

    // Save with expiration timestamp
    saveAuthData({
        access_token: response.access_token,
        expires_in: response.expires_in,
        expires_at: tokenExpiresAt
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
        tokenExpiresAt = authData.expires_at;
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

// Smart Sync: Fetch videos from all channels.
// A background sync does not move the feed under a user who scrolled down: it offers a pill instead
async function syncAllChannels(force = false, { background = false } = {}) {
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
        const knownIds = new Set(buildFeed(videoCache).map(video => video.videoId));
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
        const updatedCache = applyVideoDetails(videoCache, details);
        storeVideoCache(updatedCache);
        saveLastSync(now);

        console.log('Sync completed successfully');

        const hasNewVideos = buildFeed(updatedCache).some(video => !knownIds.has(video.videoId));
        if (background && hasNewVideos && currentView === 'feed' && window.scrollY > SCROLLED_DOWN_PX) {
            showNewVideosPill(showNewVideos);
        } else {
            renderView();
        }
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
        renderView(); // The groups page shows the subscriptions too

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

// Render video feed: unwatched videos, filtered by the active group and the search box
function renderVideoFeed() {
    hideNewVideosPill();
    watchedSinceRender = false;

    const channelIds = activeChannel ? [activeChannel.id] : activeGroup ? (getUserGroups()[activeGroup] || []) : null;
    const history = getWatchHistory();
    const groupVideos = buildFeed(getVideoCache(), channelIds);
    const unwatched = groupVideos.filter(video => !history[video.videoId]);
    const videos = unwatched.filter(video => matchesSearch(video, searchQuery));

    renderStats(Object.keys(getChannelNames()).length, videos.length);

    let emptyMessage;
    if (searchQuery.trim()) {
        emptyMessage = `Aucune vidéo ne correspond à « ${searchQuery.trim()} ».`;
    } else if (groupVideos.length > 0) {
        emptyMessage = 'Vous êtes à jour : toutes les vidéos de ce fil ont été vues.';
    } else if (accessToken) {
        emptyMessage = "Aucune vidéo disponible. Cliquez sur l'icône de synchronisation pour récupérer les dernières vidéos.";
    } else {
        emptyMessage = 'Aucune vidéo disponible. Connectez-vous pour récupérer les dernières vidéos.';
    }
    renderVideoGrid(videos, emptyMessage, getChannelAvatars(), {
        onOpen: openVideo,
        onToggleWatched: toggleWatched
    });
}

// History page: watched videos grouped by day, filtered by the search box
function renderHistoryView() {
    const entries = historyEntries(getWatchHistory()).filter(entry => matchesSearch(entry.video, searchQuery));
    const emptyMessage = searchQuery.trim()
        ? `Aucune vidéo de l'historique ne correspond à « ${searchQuery.trim()} ».`
        : 'Les vidéos que vous ouvrez depuis le fil, ou que vous marquez comme vues, apparaissent ici.';

    renderHistory(groupByDay(entries), emptyMessage, getChannelAvatars(), {
        onOpen: openVideo,
        onRemove: removeFromHistory
    });
}

function renderView() {
    if (currentView === 'history') {
        renderHistoryView();
    } else if (currentView === 'groups') {
        renderGroupsPage(groupsRouteFromHash(location.hash), searchQuery);
    } else {
        renderVideoFeed();
    }
}

const SEARCH_PLACEHOLDERS = {
    feed: 'Rechercher dans le fil',
    groups: 'Rechercher dans les groupes',
    history: 'Rechercher dans l\'historique'
};

// Route: "#historique" shows the history page, "#groupes", "#groupe/<nom>" and "#sans-groupe"
// the groups page, anything else the feed
function showViewFromHash() {
    if (location.hash === '#historique') {
        currentView = 'history';
    } else if (groupsRouteFromHash(location.hash)) {
        currentView = 'groups';
    } else {
        currentView = 'feed';
    }
    setActiveView(currentView);

    // Each page has its own search, like YouTube's history search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.placeholder = SEARCH_PLACEHOLDERS[currentView];
        searchInput.setAttribute('aria-label', searchInput.placeholder);
    }
    searchQuery = '';
    renderView();
    window.scrollTo(0, 0);
}

// A video was opened from a card: mark it watched. The card stays (dimmed) so the grid does not
// move under the cursor while opening several videos; it is hidden at the next render
function openVideo(video, card) {
    saveWatchHistory(markWatched(getWatchHistory(), video, Date.now()));
    if (currentView === 'feed') markCardWatched(card, true);
    watchedSinceRender = true;
}

// Card button: mark as watched (hidden right away, with "Annuler"), or back to unwatched
function toggleWatched(video, card) {
    const history = getWatchHistory();

    if (history[video.videoId]) {
        saveWatchHistory(unmarkWatched(history, video.videoId));
        markCardWatched(card, false);
        return;
    }

    saveWatchHistory(markWatched(history, video, Date.now()));
    renderVideoFeed();
    showToast('Vidéo marquée comme vue', {
        label: 'Annuler',
        onClick: () => {
            saveWatchHistory(unmarkWatched(getWatchHistory(), video.videoId));
            renderVideoFeed();
        }
    });
}

function removeFromHistory(videoId) {
    const history = getWatchHistory();
    const entry = history[videoId];
    if (!entry) return;

    saveWatchHistory(unmarkWatched(history, videoId));
    renderHistoryView();
    showToast('Vidéo retirée de l\'historique', {
        label: 'Annuler',
        onClick: () => {
            saveWatchHistory(markWatched(getWatchHistory(), entry.video, entry.watchedAt));
            renderHistoryView();
        }
    });
}

// Google Takeout watch-history.json chosen: merge it into the history
async function importTakeoutFile(file) {
    let watches;
    try {
        watches = parseTakeoutHistory(JSON.parse(await file.text()));
    } catch (error) {
        console.error('Error reading Takeout file:', error);
        showError('Ce fichier n\'est pas un historique YouTube au format JSON. Dans Google Takeout, choisissez le format JSON pour l\'historique.');
        return;
    }

    const before = getWatchHistory();
    const feedIds = new Set(buildFeed(getVideoCache()).map(video => video.videoId));
    const { history, added } = importWatches(before, watches, getVideoCache());
    const hidden = Object.keys(history).filter(id => feedIds.has(id) && !before[id]).length;

    saveWatchHistory(history);
    renderHistoryView();
    renderVideoFeed();
    showToast(added === 0
        ? 'Aucune nouvelle vidéo à importer.'
        : `${added} vidéo${added > 1 ? 's' : ''} importée${added > 1 ? 's' : ''} depuis YouTube, dont ${hidden} retirée${hidden > 1 ? 's' : ''} du fil.`);
}

function clearHistory() {
    if (Object.keys(getWatchHistory()).length === 0) return;
    if (!confirm('Effacer tout l\'historique ? Les vidéos réapparaîtront dans le fil.')) return;

    saveWatchHistory({});
    renderView();
}

// "Nouvelles vidéos" pill clicked (or scrolled back to the top): show them
function showNewVideos() {
    renderVideoFeed();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Automatic sync while the tab is visible and the session valid (throttled by SYNC_INTERVAL_MS)
function autoSync() {
    if (!accessToken || document.visibilityState !== 'visible') return;

    // The token cannot be renewed without a click: switch to "Se connecter" instead of calling the API
    if (Date.now() >= tokenExpiresAt) {
        handleSessionExpired();
        return;
    }

    syncAllChannels(false, { background: true });
}

// Check periodically and when the user comes back to the tab
function startAutoSync() {
    setInterval(autoSync, AUTO_SYNC_CHECK_MS);
    document.addEventListener('visibilitychange', autoSync);

    // Back at the top of the page with new videos pending: show them
    window.addEventListener('scroll', () => {
        if (window.scrollY < 50 && !document.getElementById('new-videos-pill')?.hidden) {
            renderVideoFeed();
        }
    }, { passive: true });
}

// Render the filter buttons for the current groups
function refreshFilterButtons() {
    // Hidden groups have no chip, unless one is the active filter
    const hidden = getHiddenGroups();
    const groupNames = Object.keys(getUserGroups()).filter(name => !hidden.includes(name) || name === activeGroup);

    renderFilterButtons({
        groupNames,
        activeGroup,
        activeChannel,
        onSelectGroup(groupName) {
            activeGroup = groupName;
            activeChannel = null;
            refreshFilterButtons();
            renderVideoFeed();
        },
        onClearChannel() {
            activeChannel = null;
            refreshFilterButtons();
            renderVideoFeed();
        }
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
    if (location.hash && location.hash !== '#') {
        showViewFromHash();
    }

    startAutoSync();
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
        renderView();
    });

    // Feed / history navigation, and history actions
    window.addEventListener('hashchange', showViewFromHash);
    document.getElementById('clear-history')?.addEventListener('click', clearHistory);
    const importFile = document.getElementById('import-file');
    document.getElementById('import-history')?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', () => {
        if (importFile.files[0]) importTakeoutFile(importFile.files[0]);
        importFile.value = '';
    });

    // Back on the tab after watching: hide the videos opened meanwhile
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && watchedSinceRender) {
            renderView();
        }
    });
    document.getElementById('search-form')?.addEventListener('submit', event => {
        event.preventDefault();
        searchInput?.blur();
    });

    setupGroupsPage({
        // Keep the active filter on a renamed group, drop it if the group was deleted
        // (from: null for a created or imported group)
        onGroupsChanged({ from, to }) {
            if (from !== null && activeGroup === from) {
                activeGroup = to;
            }
            if (activeGroup && getHiddenGroups().includes(activeGroup)) {
                activeGroup = null;
            }
            refreshFilterButtons();
            if (currentView === 'feed') renderVideoFeed();
        },
        // "Voir le fil" on a group: the feed, filtered on it
        onShowFeed(groupName) {
            activeGroup = groupName;
            activeChannel = null;
            refreshFilterButtons();
            location.hash = '';
        },
        // "Voir ses vidéos dans le fil" on a channel
        onShowChannelFeed(channelId, name) {
            activeChannel = { id: channelId, name };
            refreshFilterButtons();
            location.hash = '';
        }
    });
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
