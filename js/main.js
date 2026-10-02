// Global Video Feed - entry point: authentication, loading and sync

import {
    AUTO_SYNC_CHECK_MS, CLIENT_ID, DETAILS_REFRESH_MS, DRIVE_SCOPE, DRIVE_SYNC_DELAY_MS, SCOPES, SYNC_INTERVAL_MS
} from './config.js';
import {
    AuthError, fetchAllSubscriptions, fetchLatestVideos, fetchMyChannel, fetchUploadsPlaylists, fetchVideoDetails,
    QuotaError
} from './api.js';
import { DriveAccessError } from './drive.js';
import { syncWithDrive } from './drive-sync.js';
import {
    applyVideoDetails, buildFeed, channelsDue, getRelativeTime, keepChannels, matchesSearch, mergeChannelVideos,
    nextQuotaReset, quotaResetText, videosMissingDetails, videosToFetch
} from './feed.js';
import { groupsRouteFromHash, renderGroupsPage, setupGroupsPage } from './groups.js';
import {
    groupByDay, historyEntries, importWatches, markWatched, parseTakeoutHistory, unmarkWatched, watchedLookup
} from './history-model.js';
import { readZipText } from './zip.js';
import {
    clearAccount, clearAuthData, clearDriveSyncState, getAccount, getAuthData, getCacheVersion, getChannelAvatars,
    getChannelFetchedAt, getChannelNames, getDriveSyncState, getFeedLayout, getGuideCollapsed, getHiddenGroups,
    getLastSync, getPlaylistCache, getQuotaResetAt, getUserGroups, getVideoCache, getWatchHistory, getWatchedIds,
    hasStoredSession,
    saveAccount, saveAuthData, saveCacheVersion, saveChannelAvatars, saveChannelFetchedAt, saveChannelNames,
    saveDriveSyncState, saveFeedLayout, saveGuideCollapsed, saveLastSync, savePlaylistCache, saveQuotaResetAt,
    saveVideoCache, saveWatchHistory, saveWatchedIds, setSyncedChangeListener
} from './storage.js';
import {
    clearUI, hideNewVideosPill, markCardWatched, renderAccount, renderDriveSync, renderFilterButtons, renderHistory,
    renderStats, renderVideoGrid, setActiveView, setFeedLayout, setLoading, setSyncing, setupAccountMenu, showError,
    showMarkAllWatched, showNewVideosPill, showToast, updateAuthUI
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
let feedVideos = []; // Videos of the feed as last rendered (filter and search applied)
let driveAccess = false; // Whether the current token allows the Drive sync (drive.appdata granted)
let enablingDriveSync = false; // Waiting for the token asked when turning the Drive sync on
let driveSyncTimer = null; // Sync planned after a change
let driveSyncing = false;
let driveSyncError = null; // Message of the last failed sync

// Initialize Google Identity Services
function initializeGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: handleAuthResponse,
        // Popup closed or blocked
        error_callback: () => {
            enablingDriveSync = false;
            refreshDriveSyncUI();
        }
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
    const enabling = enablingDriveSync;
    enablingDriveSync = false;

    if (response.error !== undefined) {
        showError(`Erreur d'authentification: ${response.error}`);
        refreshDriveSyncUI();
        return;
    }

    // Validate expires_in
    if (!response.expires_in || response.expires_in <= 0) {
        showError('Réponse d\'authentification invalide');
        refreshDriveSyncUI();
        return;
    }

    const wasSignedIn = accessToken !== null;
    accessToken = response.access_token;
    tokenExpiresAt = Date.now() + (response.expires_in * SECONDS_TO_MILLISECONDS);
    // Google lets the user grant YouTube and refuse Drive
    driveAccess = google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE);

    // Save with expiration timestamp
    saveAuthData({
        access_token: response.access_token,
        expires_in: response.expires_in,
        expires_at: tokenExpiresAt,
        drive: driveAccess
    });

    if (enabling && driveAccess) {
        saveDriveSyncState({ ...getDriveSyncState(), enabled: true });
    } else if (enabling) {
        showError('Accès à Google Drive refusé : la synchronisation reste désactivée.');
    } else if (getDriveSyncState().enabled && !driveAccess) {
        saveDriveSyncState({ ...getDriveSyncState(), enabled: false });
        showError('Accès à Google Drive refusé : la synchronisation est désactivée.');
    }

    // Turned on from the account menu: already signed in, only the sync is new
    if (enabling && wasSignedIn) {
        refreshDriveSyncUI();
        runDriveSync();
        return;
    }

    updateAuthUI(true);
    loadSubscriptions();
}

// Request access token
function requestAccessToken() {
    if (accessToken) {
        loadSubscriptions();
    } else if (tokenClient) {
        // Empty prompt: the consent screen is only shown the first time. Drive too, when the sync is on
        tokenClient.requestAccessToken(getDriveSyncState().enabled
            ? { prompt: '', scope: `${SCOPES} ${DRIVE_SCOPE}` }
            : { prompt: '' });
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
        driveAccess = authData.drive === true;
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

        // The next account may not be the same: the sync is turned on again by hand
        driveAccess = false;
        clearTimeout(driveSyncTimer);
        clearDriveSyncState();
        refreshDriveSyncUI();

        updateAuthUI(false);
        clearUI();
    }
}

// Handle an expired or revoked access token: keep the cached feed visible
function handleSessionExpired() {
    accessToken = null;
    updateAuthUI(false);
    refreshDriveSyncUI();
    showError('Session expirée. Reconnectez-vous pour mettre à jour le flux.');
}

// The daily YouTube quota is used up: no request until it is renewed
function quotaUsedUp() {
    return Date.now() < getQuotaResetAt();
}

function showQuotaUsedUp() {
    showError(`Quota YouTube du jour épuisé : les vidéos se remettront à jour ${quotaResetText(getQuotaResetAt())}.`);
}

function handleQuotaUsedUp() {
    saveQuotaResetAt(nextQuotaReset());
    showQuotaUsedUp();
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
    saveChannelFetchedAt({});
    saveLastSync(0);
    saveCacheVersion(CACHE_VERSION);
}

// The history alone used to hold the watched videos: add its videos to the full list, so that
// removing them later is recorded for the other devices too
function upgradeWatchedIds() {
    const ids = getWatchedIds();
    const known = new Set(ids);
    const missing = Object.keys(getWatchHistory()).filter(id => !known.has(id));
    if (missing.length > 0) saveWatchedIds([...ids, ...missing]);
}

// Forget channels the user is no longer subscribed to
function pruneUnsubscribedChannels(channelIds) {
    savePlaylistCache(keepChannels(getPlaylistCache(), channelIds));
    storeVideoCache(keepChannels(getVideoCache(), channelIds));
    saveChannelFetchedAt(keepChannels(getChannelFetchedAt(), channelIds));
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

// Smart Sync: fetch the latest videos of the channels due, each one as often as it publishes.
// A background sync does not move the feed under a user who scrolled down: it offers a pill instead
async function syncAllChannels(force = false, { background = false } = {}) {
    if (isSyncing) {
        console.log('Sync skipped: already in progress');
        return;
    }

    if (quotaUsedUp()) {
        if (force) showQuotaUsedUp();
        return;
    }

    // Check if sync is needed
    const now = Date.now();

    if (!force && (now - getLastSync()) < SYNC_INTERVAL_MS) {
        console.log('Sync skipped: last sync was too recent');
        return;
    }

    // Get playlist cache as [channelId, playlistId] pairs
    const playlists = getPlaylistCache();
    if (Object.keys(playlists).length === 0) {
        console.log('No playlists to sync');
        return;
    }

    // Only the channels whose wait is over (see channelSyncInterval)
    const lastReads = getChannelFetchedAt();
    const due = new Set(channelsDue(Object.keys(playlists), getVideoCache(), lastReads, now));
    const channels = Object.entries(playlists).filter(([channelId]) => due.has(channelId));
    if (channels.length === 0) {
        console.log('Sync skipped: no channel due');
        saveLastSync(now);
        return;
    }

    setLoading(true, 'Mise à jour du flux...');
    setSyncing(true);
    isSyncing = true;

    try {
        // Fetch videos from all playlists in parallel. Once the quota is used up, the requests
        // still answered are kept
        let quotaHit = false;
        const unlessQuota = fallback => error => {
            if (!(error instanceof QuotaError)) throw error;
            quotaHit = true;
            return fallback;
        };
        const results = await Promise.all(
            channels.map(([channelId, playlistId]) => fetchLatestVideos(playlistId, accessToken,
                videosToFetch(lastReads[channelId], now)).catch(unlessQuota(null)))
        );

        // Every request failed: keep the previous timestamp so the next load retries
        if (results.every(videos => videos === null)) {
            if (quotaHit) {
                handleQuotaUsedUp();
            } else {
                showError('Erreur lors de la synchronisation des vidéos');
            }
            return;
        }

        // Merge results into cache, keeping the unwatched videos
        const videoCache = getVideoCache();
        const knownIds = new Set(buildFeed(videoCache).map(video => video.videoId));
        const watched = watchedLookup(getWatchHistory(), getWatchedIds());
        results.forEach((videos, index) => {
            if (!videos || videos.length === 0) return;

            const [channelId] = channels[index];
            videoCache[channelId] = mergeChannelVideos(videos, videoCache[channelId], {
                isWatched: id => Boolean(watched[id]),
                now
            });
        });

        // Durations and view counts: refresh the recent videos just fetched (views still moving)
        // and fill in any cached video that has none yet
        const fetchedIds = results.filter(Boolean).flat()
            .filter(item => now - Date.parse(item.snippet?.publishedAt) < DETAILS_REFRESH_MS)
            .map(item => item.snippet?.resourceId?.videoId);
        const detailIds = [...new Set([...fetchedIds, ...videosMissingDetails(videoCache)])].filter(Boolean);
        const details = await fetchVideoDetails(detailIds, accessToken).catch(unlessQuota({}));

        // Save updated cache and timestamps
        const updatedCache = applyVideoDetails(videoCache, details);
        storeVideoCache(updatedCache);
        saveLastSync(now);
        results.forEach((videos, index) => {
            if (videos !== null) lastReads[channels[index][0]] = now;
        });
        saveChannelFetchedAt({ ...getChannelFetchedAt(), ...lastReads });

        console.log('Sync completed successfully');

        const hasNewVideos = buildFeed(updatedCache).some(video => !knownIds.has(video.videoId));
        if (background && hasNewVideos && currentView === 'feed' && window.scrollY > SCROLLED_DOWN_PX) {
            showNewVideosPill(showNewVideos);
        } else {
            renderView();
        }
        refreshFilterButtons();
        if (quotaHit) handleQuotaUsedUp();

    } catch (error) {
        if (error instanceof AuthError) {
            handleSessionExpired();
        } else if (error instanceof QuotaError) {
            handleQuotaUsedUp();
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
        // First, load videos from cache immediately, and get the changes made on other devices
        renderVideoFeed();
        runDriveSync();

        // No YouTube request until the quota is renewed: the cached feed only
        if (quotaUsedUp()) {
            refreshFilterButtons();
            showQuotaUsedUp();
            return;
        }

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
        } else if (error instanceof QuotaError) {
            refreshFilterButtons();
            handleQuotaUsedUp();
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
    const watched = watchedLookup(getWatchHistory(), getWatchedIds());
    const groupVideos = buildFeed(getVideoCache(), channelIds);
    const unwatched = groupVideos.filter(video => !watched[video.videoId]);
    const videos = unwatched.filter(video => matchesSearch(video, searchQuery));
    feedVideos = videos;

    renderStats(Object.keys(getChannelNames()).length, videos.length);
    showMarkAllWatched(activeGroup || activeChannel ? videos.length : 0);

    let emptyMessage;
    if (searchQuery.trim()) {
        emptyMessage = `Aucune vidéo ne correspond à « ${searchQuery.trim()} ».`;
    } else if (channelIds?.length === 0) {
        emptyMessage = `Le groupe « ${activeGroup} » ne contient aucune chaîne. Ajoutez-en depuis la page Groupes.`;
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

// Record a watch: in the detailed history, and in the full list of watched IDs
function recordWatch(video, watchedAt) {
    saveWatchHistory(markWatched(getWatchHistory(), video, watchedAt));
    const ids = getWatchedIds();
    if (!ids.includes(video.videoId)) saveWatchedIds([...ids, video.videoId]);
}

function forgetWatch(videoId) {
    saveWatchHistory(unmarkWatched(getWatchHistory(), videoId));
    saveWatchedIds(getWatchedIds().filter(id => id !== videoId));
}

// A video was opened from a card: mark it watched. The card stays (dimmed) so the grid does not
// move under the cursor while opening several videos; it is hidden at the next render
function openVideo(video, card) {
    recordWatch(video, Date.now());
    if (currentView === 'feed') markCardWatched(card, true);
    watchedSinceRender = true;
}

// Card button: mark as watched (hidden right away, with "Annuler"), or back to unwatched
function toggleWatched(video, card) {
    if (watchedLookup(getWatchHistory(), getWatchedIds())[video.videoId]) {
        forgetWatch(video.videoId);
        markCardWatched(card, false);
        return;
    }

    recordWatch(video, Date.now());
    renderVideoFeed();
    showToast('Vidéo marquée comme vue', {
        label: 'Annuler',
        onClick: () => {
            forgetWatch(video.videoId);
            renderVideoFeed();
        }
    });
}

// "Tout marquer comme vu" on a group or a channel: its videos leave the feed, with "Annuler". They
// join the watched videos but not the history, which keeps the videos really opened
function markAllWatched() {
    const ids = feedVideos.map(video => video.videoId);
    if (ids.length === 0) return;

    saveWatchedIds([...new Set([...getWatchedIds(), ...ids])]);
    renderVideoFeed();
    const many = ids.length > 1 ? 's' : '';
    showToast(`${ids.length} vidéo${many} marquée${many} comme vue${many}`, {
        label: 'Annuler',
        onClick: () => {
            const marked = new Set(ids);
            saveWatchedIds(getWatchedIds().filter(id => !marked.has(id)));
            renderVideoFeed();
        }
    });
}

function removeFromHistory(videoId) {
    const history = getWatchHistory();
    const entry = history[videoId];
    if (!entry) return;

    forgetWatch(videoId);
    renderHistoryView();
    showToast('Vidéo retirée de l\'historique', {
        label: 'Annuler',
        onClick: () => {
            recordWatch(entry.video, entry.watchedAt);
            renderHistoryView();
        }
    });
}

// Text of the watch history in a Takeout file: the JSON itself, or the archive that holds it
async function readTakeoutHistory(file) {
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
    if (!isZip) return file.text();

    const text = await readZipText(await file.arrayBuffer(), name => /watch-history\.json$/i.test(name));
    if (text === null) {
        throw new Error('No watch-history.json in the archive');
    }
    return text;
}

// Google Takeout export chosen (watch-history.json, or the .zip archive): merge it into the history
async function importTakeoutFile(file) {
    let watches;
    try {
        watches = parseTakeoutHistory(JSON.parse(await readTakeoutHistory(file)));
    } catch (error) {
        console.error('Error reading Takeout file:', error);
        showError(/\.zip$/i.test(file.name)
            ? 'L\'archive ne contient pas de fichier watch-history.json. Dans Google Takeout, exportez l\'historique YouTube au format JSON.'
            : 'Ce fichier n\'est pas un historique YouTube au format JSON. Dans Google Takeout, choisissez le format JSON pour l\'historique.');
        return;
    }

    // Every watched video hides from the feed; the detailed history keeps the most recent ones
    const watchedBefore = new Set([...getWatchedIds(), ...Object.keys(getWatchHistory())]);
    const newIds = [...new Set(watches.map(watch => watch.videoId))].filter(id => !watchedBefore.has(id));
    const feedIds = new Set(buildFeed(getVideoCache()).map(video => video.videoId));
    const hidden = newIds.filter(id => feedIds.has(id)).length;
    const added = newIds.length;

    saveWatchedIds([...new Set([...getWatchedIds(), ...watches.map(watch => watch.videoId)])]);
    saveWatchHistory(importWatches(getWatchHistory(), watches, getVideoCache()).history);
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
    saveWatchedIds([]);
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
    runDriveSync();
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

// --- Google Drive sync ---

// Sync the groups and the watched videos with Drive, when the sync is on and the session allows it
async function runDriveSync() {
    clearTimeout(driveSyncTimer);
    driveSyncTimer = null;
    if (!getDriveSyncState().enabled || !accessToken || !driveAccess || Date.now() >= tokenExpiresAt) return;

    driveSyncing = true;
    driveSyncError = null;
    refreshDriveSyncUI();
    try {
        const { changed } = await syncWithDrive(accessToken);
        if (changed) showSyncedChanges();
    } catch (error) {
        if (error instanceof AuthError) {
            handleSessionExpired();
        } else if (error instanceof DriveAccessError) {
            driveAccess = false;
            saveDriveSyncState({ ...getDriveSyncState(), enabled: false });
            showError('Accès à Google Drive retiré : la synchronisation est désactivée.');
        } else {
            console.error('Error during Drive sync:', error);
            driveSyncError = 'Échec de la dernière synchronisation';
        }
    } finally {
        driveSyncing = false;
        refreshDriveSyncUI();
    }
}

// A change to the synced data: send it after a pause, so that several changes go together
function scheduleDriveSync() {
    if (!getDriveSyncState().enabled) return;
    clearTimeout(driveSyncTimer);
    driveSyncTimer = setTimeout(runDriveSync, DRIVE_SYNC_DELAY_MS);
}

// Data merged from another device: drop the filter on a group that no longer exists, show the rest
function showSyncedChanges() {
    if (activeGroup && !Object.hasOwn(getUserGroups(), activeGroup)) {
        activeGroup = null;
    }
    refreshFilterButtons();
    renderView();
}

// Account menu switch: turning the sync on asks Google for Drive access (once), then syncs
function toggleDriveSync() {
    const state = getDriveSyncState();
    if (state.enabled) {
        clearTimeout(driveSyncTimer);
        saveDriveSyncState({ ...state, enabled: false });
        refreshDriveSyncUI();
    } else if (accessToken && driveAccess) {
        saveDriveSyncState({ ...state, enabled: true });
        runDriveSync();
    } else if (tokenClient) {
        enablingDriveSync = true;
        refreshDriveSyncUI();
        tokenClient.requestAccessToken({ prompt: '', scope: `${SCOPES} ${DRIVE_SCOPE}` });
    } else {
        showError('Le service Google n\'est pas encore chargé, réessayez dans un instant.');
    }
}

// Switch and status line of the account menu
function refreshDriveSyncUI() {
    const state = getDriveSyncState();
    let status;
    if (enablingDriveSync) {
        status = 'Autorisation de Google Drive…';
    } else if (!state.enabled) {
        status = 'Désactivée';
    } else if (driveSyncing) {
        status = 'Synchronisation…';
    } else if (driveSyncError) {
        status = driveSyncError;
    } else if (!accessToken) {
        status = 'Reconnectez-vous pour synchroniser';
    } else {
        status = state.syncedAt ? `Synchronisé ${getRelativeTime(new Date(state.syncedAt).toISOString())}` : 'Activée';
    }
    renderDriveSync(Boolean(state.enabled), status);
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
    upgradeWatchedIds();
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

    // Installable app, which opens offline too (see sw.js)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(error => console.error('Service worker not registered:', error));
    }
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
    document.getElementById('force-sync-button')?.addEventListener('click', () => {
        syncAllChannels(true);
        runDriveSync();
    });
    setupAccountMenu(refreshDriveSyncUI);
    document.getElementById('drive-sync-toggle')?.addEventListener('click', toggleDriveSync);
    document.getElementById('mark-all-watched')?.addEventListener('click', markAllWatched);
    setSyncedChangeListener(scheduleDriveSync);
    refreshDriveSyncUI();

    // Menu button: collapse / expand the left navigation (remembered)
    document.body.classList.toggle('guide-collapsed', getGuideCollapsed());
    document.getElementById('guide-button')?.addEventListener('click', () => {
        saveGuideCollapsed(document.body.classList.toggle('guide-collapsed'));
    });

    // List / grid toggle of the feed (remembered)
    setFeedLayout(getFeedLayout());
    document.querySelectorAll('.layout-toggle-button').forEach(button => {
        button.addEventListener('click', () => {
            saveFeedLayout(button.dataset.layout);
            setFeedLayout(button.dataset.layout);
        });
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

    // Back on the tab after watching: hide the videos opened meanwhile.
    // Leaving it: send the changes waiting for Drive now, before going to another device
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && watchedSinceRender) {
            renderView();
        }
        if (document.visibilityState === 'hidden' && driveSyncTimer) {
            runDriveSync();
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
