// Watch history logic: pure functions on { videoId: { watchedAt, video } } (see tests/)

import { MAX_HISTORY } from './config.js';

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

// Copy of the history with the video marked as watched at the given time
export function markWatched(history, video, watchedAt) {
    return trim({ ...history, [video.videoId]: { watchedAt, video: snapshot(video) } });
}

// Copy of the history without the video
export function unmarkWatched(history, videoId) {
    return Object.fromEntries(Object.entries(history).filter(([id]) => id !== videoId));
}

// History entries, most recently watched first
export function historyEntries(history) {
    return Object.values(history).sort((a, b) => b.watchedAt - a.watchedAt);
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
