// Watch history logic: pure functions on { videoId: { watchedAt, video } } (see tests/)

import { MAX_HISTORY } from './config.js';
import { isValidYouTubeId } from './feed.js';

// "Vous avez regardé <titre>" / "Watched <title>": the prefix Takeout puts before titles
const TAKEOUT_TITLE_PREFIX = /^(Vous avez regardé|Watched|Has visto|Hai guardato|Assistiu a|Angesehen:?)\s+/;

// Fields of a feed video kept in the history, so it can be shown after leaving the cache
function snapshot(video) {
    const { videoId, title, channelTitle, channelId, publishedAt, thumbnail, duration, views } = video;
    return { videoId, title, channelTitle, channelId, publishedAt, thumbnail, duration, views };
}

// Keep the MAX_HISTORY most recent entries
function trim(history) {
    const entries = Object.entries(history).sort(([, a], [, b]) => b.watchedAt - a.watchedAt);
    return Object.fromEntries(entries.slice(0, MAX_HISTORY));
}

// Lookup usable as `watched[videoId]`: the detailed history plus the full list of watched IDs
export function watchedLookup(history, watchedIds) {
    const lookup = Object.create(null);
    watchedIds.forEach(id => { lookup[id] = true; });
    Object.assign(lookup, history);
    return lookup;
}

// Copy of the history with the video marked as watched at the given time
export function markWatched(history, video, watchedAt) {
    return trim({ ...history, [video.videoId]: { watchedAt, video: snapshot(video) } });
}

// Copy of the history without the video
export function unmarkWatched(history, videoId) {
    return Object.fromEntries(Object.entries(history).filter(([id]) => id !== videoId));
}

// History of two devices merged: each video once (its latest watch), only the videos for which
// keep(videoId) is true, and the MAX_HISTORY most recent
export function mergeHistory(first = {}, second = {}, keep = () => true) {
    const merged = new Map();
    [first, second].forEach(history => Object.entries(history).forEach(([videoId, entry]) => {
        if (!keep(videoId)) return;
        const existing = merged.get(videoId);
        if (!existing || entry.watchedAt > existing.watchedAt) merged.set(videoId, entry);
    }));
    return trim(Object.fromEntries(merged));
}

// History entries, most recently watched first
export function historyEntries(history) {
    return Object.values(history).sort((a, b) => b.watchedAt - a.watchedAt);
}

// Watched videos from a Google Takeout "watch-history.json" (array of activity records).
// Skips ads, removed videos and anything that is not a video. Throws if it is not such a file.
// Returns [{ videoId, title, channelTitle, channelId, watchedAt }], one per video (latest watch)
export function parseTakeoutHistory(records) {
    if (!Array.isArray(records)) {
        throw new Error('Not a Takeout watch history');
    }

    const latest = new Map();
    records.forEach(record => {
        if (!record || typeof record !== 'object' || record.details) return; // "details" marks ads

        let videoId = null;
        try {
            const url = new URL(record.titleUrl);
            videoId = url.pathname === '/watch' ? url.searchParams.get('v') : null;
        } catch (error) {
            return; // No link: removed video, survey, etc.
        }

        const watchedAt = Date.parse(record.time);
        if (!isValidYouTubeId(videoId) || isNaN(watchedAt)) return;

        const channel = Array.isArray(record.subtitles) ? record.subtitles[0] : null;
        const channelId = /\/channel\/([\w-]+)/.exec(channel?.url || '')?.[1] || null;

        const previous = latest.get(videoId);
        if (!previous || previous.watchedAt < watchedAt) {
            latest.set(videoId, {
                videoId,
                title: String(record.title || '').replace(TAKEOUT_TITLE_PREFIX, ''),
                channelTitle: channel?.name || '',
                channelId,
                watchedAt
            });
        }
    });

    return [...latest.values()];
}

// Copy of the history with imported watches added; the most recent watch of a video wins,
// and feed videos (videoCache) keep their full details. Returns { history, added }
export function importWatches(history, watches, videoCache = {}) {
    const cachedById = new Map();
    Object.entries(videoCache).forEach(([channelId, videos]) => {
        videos.forEach(video => cachedById.set(video.videoId, { ...video, channelId }));
    });

    const merged = { ...history };

    watches.forEach(({ videoId, title, channelTitle, channelId, watchedAt }) => {
        const existing = merged[videoId];
        if (existing && existing.watchedAt >= watchedAt) return;

        const video = cachedById.get(videoId) || existing?.video || {
            videoId, title, channelTitle, channelId,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
        };
        merged[videoId] = { watchedAt, video: snapshot(video) };
    });

    const trimmed = trim(merged);
    return { history: trimmed, added: Object.keys(trimmed).filter(id => !history[id]).length };
}

function startOfDay(timestamp) {
    const date = new Date(timestamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Day heading, as on the YouTube history page: "Aujourd'hui", "Hier", "lundi", "28 septembre"
export function dayLabel(timestamp, now = Date.now()) {
    const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / (24 * 3600 * 1000));

    if (days <= 0) return 'Aujourd\'hui';
    if (days === 1) return 'Hier';
    if (days < 7) return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(timestamp);

    const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
    const options = sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' };
    return new Intl.DateTimeFormat('fr-FR', options).format(timestamp);
}

// Entries (already sorted) grouped under their day heading: [{ label, entries }]
export function groupByDay(entries, now = Date.now()) {
    const groups = [];
    entries.forEach(entry => {
        const label = dayLabel(entry.watchedAt, now);
        const last = groups[groups.length - 1];
        if (last && last.label === label) {
            last.entries.push(entry);
        } else {
            groups.push({ label, entries: [entry] });
        }
    });
    return groups;
}
