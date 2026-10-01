// Persistence in localStorage

const AUTH_KEY = 'yt_auth_token';
const PLAYLISTS_KEY = 'yt_playlist_cache';
const VIDEOS_KEY = 'yt_video_cache';
const LAST_SYNC_KEY = 'yt_last_sync';
const GROUPS_KEY = 'yt_user_groups';
const CHANNEL_NAMES_KEY = 'yt_channel_names';
const CHANNEL_AVATARS_KEY = 'yt_channel_avatars';
const CACHE_VERSION_KEY = 'yt_cache_version';

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

// Timestamp (ms) of the last successful sync
export function getLastSync() {
    return Number(readJSON(LAST_SYNC_KEY, 0)) || 0;
}

export function saveLastSync(timestamp) {
    return writeJSON(LAST_SYNC_KEY, timestamp);
}

// { group name: [channelId, ...] }
export function getUserGroups() {
    return readJSON(GROUPS_KEY, {});
}

export function saveUserGroups(groups) {
    return writeJSON(GROUPS_KEY, groups);
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

// Format version of the video cache (0 = written before versioning)
export function getCacheVersion() {
    return Number(readJSON(CACHE_VERSION_KEY, 0)) || 0;
}

export function saveCacheVersion(version) {
    return writeJSON(CACHE_VERSION_KEY, version);
}
