// Persistence in localStorage

import { withFavorites } from './groups-model.js';
import { packStamps, stampChanges, unpackStamps } from './sync-model.js';

const AUTH_KEY = 'yt_auth_token';
const PLAYLISTS_KEY = 'yt_playlist_cache';
const VIDEOS_KEY = 'yt_video_cache';
const LAST_SYNC_KEY = 'yt_last_sync';
const GROUPS_KEY = 'yt_user_groups';
const CHANNEL_NAMES_KEY = 'yt_channel_names';
const CHANNEL_AVATARS_KEY = 'yt_channel_avatars';
const CACHE_VERSION_KEY = 'yt_cache_version';
const ACCOUNT_KEY = 'yt_account';
const GUIDE_COLLAPSED_KEY = 'yt_guide_collapsed';
const WATCH_HISTORY_KEY = 'yt_watch_history';
const HIDDEN_GROUPS_KEY = 'yt_hidden_groups';
const WATCHED_IDS_KEY = 'yt_watched_ids';
const FEED_LAYOUT_KEY = 'yt_feed_layout';
const SYNC_STAMPS_KEY = 'yt_sync_stamps';
const DRIVE_SYNC_KEY = 'yt_drive_sync';
const QUOTA_RESET_KEY = 'yt_quota_reset_at';

let onSyncedChange = () => {};

// Read a JSON value, or the fallback if it is missing or unreadable
function readJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.error(`Error reading ${key}:`, error);
        return fallback;
    }
}

// Write a JSON value; returns false if the browser refused it (e.g. storage full)
function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error(`Error saving ${key}:`, error);
        return false;
    }
}

// Write a synced value, and stamp what changed from before to after (same fields), so that
// another device can merge it (see sync-model.js)
function writeSynced(key, value, before, after) {
    const written = writeJSON(key, value);
    if (written) {
        writeJSON(SYNC_STAMPS_KEY, packStamps(stampChanges(getSyncStamps(), before, after, Date.now())));
        onSyncedChange();
    }
    return written;
}

function remove(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.error(`Error removing ${key}:`, error);
    }
}

// Access token and its expiration ({ access_token, expires_in, expires_at })
export function getAuthData() {
    return readJSON(AUTH_KEY, null);
}

export function saveAuthData(authData) {
    return writeJSON(AUTH_KEY, authData);
}

export function clearAuthData() {
    remove(AUTH_KEY);
}

// Whether the user signed in before and did not sign out
export function hasStoredSession() {
    try {
        return localStorage.getItem(AUTH_KEY) !== null;
    } catch (error) {
        return false;
    }
}

// { channelId: uploads playlist ID }
export function getPlaylistCache() {
    return readJSON(PLAYLISTS_KEY, {});
}

export function savePlaylistCache(cache) {
    return writeJSON(PLAYLISTS_KEY, cache);
}

// { channelId: [cached video, ...] }
export function getVideoCache() {
    return readJSON(VIDEOS_KEY, {});
}

export function saveVideoCache(cache) {
    return writeJSON(VIDEOS_KEY, cache);
}

// Until when the daily YouTube quota is used up (timestamp, 0 if it is not)
export function getQuotaResetAt() {
    return Number(readJSON(QUOTA_RESET_KEY, 0)) || 0;
}

export function saveQuotaResetAt(timestamp) {
    return writeJSON(QUOTA_RESET_KEY, timestamp);
}

// Timestamp (ms) of the last successful sync
export function getLastSync() {
    return Number(readJSON(LAST_SYNC_KEY, 0)) || 0;
}

export function saveLastSync(timestamp) {
    return writeJSON(LAST_SYNC_KEY, timestamp);
}

// { group name: [channelId, ...] }, always starting with the favorites
export function getUserGroups() {
    return withFavorites(readJSON(GROUPS_KEY, {}));
}

export function saveUserGroups(groups) {
    return writeSynced(GROUPS_KEY, groups, { groups: getUserGroups() }, { groups: withFavorites(groups) });
}

// { channelId: channel name }
export function getChannelNames() {
    return readJSON(CHANNEL_NAMES_KEY, {});
}

export function saveChannelNames(names) {
    return writeJSON(CHANNEL_NAMES_KEY, names);
}

// { channelId: avatar URL }
export function getChannelAvatars() {
    return readJSON(CHANNEL_AVATARS_KEY, {});
}

export function saveChannelAvatars(avatars) {
    return writeJSON(CHANNEL_AVATARS_KEY, avatars);
}

// Signed-in user's channel: { name, avatar }
export function getAccount() {
    return readJSON(ACCOUNT_KEY, null);
}

export function saveAccount(account) {
    return writeJSON(ACCOUNT_KEY, account);
}

export function clearAccount() {
    remove(ACCOUNT_KEY);
}

// Whether the left navigation is collapsed (menu button)
export function getGuideCollapsed() {
    return readJSON(GUIDE_COLLAPSED_KEY, false) === true;
}

export function saveGuideCollapsed(collapsed) {
    return writeJSON(GUIDE_COLLAPSED_KEY, collapsed);
}

// Feed layout: 'grid' (cards) or 'list' (compact rows)
export function getFeedLayout() {
    return readJSON(FEED_LAYOUT_KEY, 'grid') === 'list' ? 'list' : 'grid';
}

export function saveFeedLayout(layout) {
    return writeJSON(FEED_LAYOUT_KEY, layout);
}

// Names of the groups hidden from the feed filters
export function getHiddenGroups() {
    const hidden = readJSON(HIDDEN_GROUPS_KEY, []);
    return Array.isArray(hidden) ? hidden : [];
}

export function saveHiddenGroups(names) {
    return writeSynced(HIDDEN_GROUPS_KEY, names, { hiddenGroups: getHiddenGroups() }, { hiddenGroups: names });
}

// IDs of every video ever watched or imported, to hide them from the feed (the detailed
// history below is capped, this list is not)
export function getWatchedIds() {
    const ids = readJSON(WATCHED_IDS_KEY, []);
    return Array.isArray(ids) ? ids : [];
}

export function saveWatchedIds(ids) {
    return writeSynced(WATCHED_IDS_KEY, ids, { watchedIds: getWatchedIds() }, { watchedIds: ids });
}

// Watched videos: { videoId: { watchedAt, video } }
export function getWatchHistory() {
    return readJSON(WATCH_HISTORY_KEY, {});
}

export function saveWatchHistory(history) {
    return writeJSON(WATCH_HISTORY_KEY, history);
}

// Format version of the video cache (0 = written before versioning)
export function getCacheVersion() {
    return Number(readJSON(CACHE_VERSION_KEY, 0)) || 0;
}

export function saveCacheVersion(version) {
    return writeJSON(CACHE_VERSION_KEY, version);
}

// Time of the last change of every synced element (see sync-model.js)
export function getSyncStamps() {
    return unpackStamps(readJSON(SYNC_STAMPS_KEY, null));
}

// Call listener after each change to the synced data made on this device
export function setSyncedChangeListener(listener) {
    onSyncedChange = listener;
}

// This device's synced data and its stamps (see sync-model.js)
export function getSyncedReplica() {
    return {
        data: { groups: getUserGroups(), hiddenGroups: getHiddenGroups(), watchedIds: getWatchedIds(), history: getWatchHistory() },
        stamps: getSyncStamps()
    };
}

// Replace them with a merged version, which comes with its own stamps
export function saveSyncedReplica({ data, stamps }) {
    return [
        writeJSON(GROUPS_KEY, data.groups),
        writeJSON(HIDDEN_GROUPS_KEY, data.hiddenGroups),
        writeJSON(WATCHED_IDS_KEY, data.watchedIds),
        writeJSON(WATCH_HISTORY_KEY, data.history),
        writeJSON(SYNC_STAMPS_KEY, packStamps(stamps))
    ].every(Boolean);
}

// Google Drive sync on this device: { enabled, fileId, version, uploadedLast, syncedAt }
export function getDriveSyncState() {
    const state = readJSON(DRIVE_SYNC_KEY, {});
    return state && typeof state === 'object' ? state : {};
}

export function saveDriveSyncState(state) {
    return writeJSON(DRIVE_SYNC_KEY, state);
}

export function clearDriveSyncState() {
    remove(DRIVE_SYNC_KEY);
}
