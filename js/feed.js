// Feed logic: pure functions, without DOM or storage access (see tests/)

import { MAX_VIDEOS_PER_CHANNEL } from './config.js';

// Validate YouTube ID format (alphanumeric, underscore, hyphen)
export function isValidYouTubeId(id) {
    return Boolean(id) && /^[a-zA-Z0-9_-]+$/.test(id);
}

// Playlist of a channel's long-form videos (no Shorts), derived from its uploads playlist:
// UUxxxx → UULFxxxx. Not documented by the API, hence the fallback in fetchLatestVideos
export function longFormPlaylistId(uploadsPlaylistId) {
    return uploadsPlaylistId.startsWith('UU') ? `UULF${uploadsPlaylistId.slice(2)}` : uploadsPlaylistId;
}

// Keep only the fields the feed needs from a playlistItems API item
export function toCachedVideo(item) {
    const snippet = item.snippet || {};
    const thumbnails = snippet.thumbnails || {};
    return {
        videoId: snippet.resourceId?.videoId,
        title: snippet.title,
        channelTitle: snippet.channelTitle,
        publishedAt: snippet.publishedAt,
        thumbnail: thumbnails.high?.url || // Use High quality if available for big cards
                   thumbnails.medium?.url ||
                   thumbnails.default?.url || ''
    };
}

// Merge freshly fetched playlist items into a channel's cached videos
export function mergeChannelVideos(items, cachedVideos = []) {
    const cachedById = new Map(cachedVideos.map(video => [video.videoId, video]));

    // Fresh snippet data wins, details already known (duration, views) are kept
    const fetchedVideos = items
        .map(toCachedVideo)
        .filter(video => video.videoId)
        .map(video => ({ ...cachedById.get(video.videoId), ...video }));
    const fetchedVideoIds = new Set(fetchedVideos.map(video => video.videoId));

    // Keep older cached videos that were not returned again
    const olderVideos = cachedVideos.filter(video => !fetchedVideoIds.has(video.videoId));

    return [...fetchedVideos, ...olderVideos].slice(0, MAX_VIDEOS_PER_CHANNEL);
}

// IDs of cached videos whose details (duration, views) were never fetched
export function videosMissingDetails(videoCache) {
    return Object.values(videoCache)
        .flat()
        .filter(video => video.duration === undefined)
        .map(video => video.videoId);
}

// Copy of the video cache with fetched details ({ videoId: { duration, views } }) applied
export function applyVideoDetails(videoCache, details) {
    return Object.fromEntries(Object.entries(videoCache).map(([channelId, videos]) => [
        channelId,
        videos.map(video => details[video.videoId] ? { ...video, ...details[video.videoId] } : video)
    ]));
}

// ISO 8601 duration from the API ("PT1H2M3S", "P1DT2H", "P0D") to seconds, null if unreadable
export function parseIsoDuration(iso) {
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
    if (!match) return null;

    const [days, hours, minutes, seconds] = match.slice(1).map(part => Number(part) || 0);
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

// Duration badge text, as on YouTube: "0:45", "12:05", "1:02:03"
export function formatDuration(totalSeconds) {
    if (!totalSeconds) return '';

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');

    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// View count as shown by YouTube in French: "345 vues", "1,2 k vues", "3,4 M de vues"
export function formatViews(views) {
    if (views === null || views === undefined) return '';
    if (views === 0) return 'Aucune vue';
    if (views === 1) return '1 vue';
    if (views < 1000) return `${views} vues`;

    // YouTube truncates (1 290 → "1,2 k") and keeps one decimal below 10 of the unit
    const compact = (value, unit) => {
        const shown = value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value);
        return `${String(shown).replace('.', ',')} ${unit}`;
    };

    if (views < 1e6) return `${compact(views / 1e3, 'k')} vues`;
    if (views < 1e9) return `${compact(views / 1e6, 'M')} de vues`;
    return `${compact(views / 1e9, 'Md')} de vues`;
}

// Copy of a { channelId: value } map limited to the given channels
export function keepChannels(map, channelIds) {
    const kept = new Set(channelIds);
    return Object.fromEntries(Object.entries(map).filter(([channelId]) => kept.has(channelId)));
}

// Flatten the video cache into one list, newest first, optionally limited to some channels
export function buildFeed(videoCache, channelIds = null) {
    const allowed = channelIds ? new Set(channelIds) : null;
    const videos = [];

    Object.entries(videoCache).forEach(([channelId, channelVideos]) => {
        if (allowed && !allowed.has(channelId)) return;
        (channelVideos || []).forEach(video => videos.push({ ...video, channelId }));
    });

    return videos.sort((a, b) => {
        const dateA = new Date(a.publishedAt || 0).getTime();
        const dateB = new Date(b.publishedAt || 0).getTime();
        return dateB - dateA;
    });
}

// Lowercase text without accents, for search ("Électro" matches "electro")
export function normalizeText(text) {
    return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Whether every word of the query appears in the video title or channel name
export function matchesSearch(video, query) {
    const haystack = normalizeText(`${video.title} ${video.channelTitle}`);
    return normalizeText(query).split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// How long a channel may wait between two reads, from the age of its latest known video: a
// channel that publishes often is read at every sync, one silent for a year once a week
export const CHANNEL_SYNC_TIERS = [
    { youngerThan: 14 * DAY_MS, every: 0 },
    { youngerThan: 60 * DAY_MS, every: 6 * HOUR_MS },
    { youngerThan: 365 * DAY_MS, every: DAY_MS },
    { youngerThan: Infinity, every: 7 * DAY_MS }
];

// Wait between two reads of a channel, from its cached videos (never read: at every sync)
export function channelSyncInterval(channelVideos, now = Date.now()) {
    const latest = Math.max(...(channelVideos || []).map(video => Date.parse(video.publishedAt)).filter(Number.isFinite));
    if (!Number.isFinite(latest)) return 0;
    return CHANNEL_SYNC_TIERS.find(tier => now - latest < tier.youngerThan).every;
}

// Channels to read in this sync: those whose wait since their last read ({ channelId: time }) is over
export function channelsDue(channelIds, videoCache, fetchedAt, now = Date.now()) {
    return channelIds.filter(id => now - (fetchedAt[id] || 0) >= channelSyncInterval(videoCache[id], now));
}

// Next renewal of the daily YouTube quota: midnight, Pacific time (timestamp)
export function nextQuotaReset(now = Date.now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
    }).formatToParts(now).map(({ type, value }) => [type, Number(value)]));

    // Pacific wall-clock time read as UTC, minus the real time: the offset of Pacific time
    const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
        - Math.floor(now / 1000) * 1000;
    return Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offset;
}

// When the quota comes back, worded for the user: "à partir de 09:00", "demain à partir de 09:00"
export function quotaResetText(reset, now = Date.now()) {
    const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(reset);
    const sameDay = new Date(reset).toDateString() === new Date(now).toDateString();
    return `${sameDay ? '' : 'demain '}à partir de ${time}`;
}

// Relative publication time, worded like YouTube: "il y a 3 heures", "il y a 2 semaines"
export function getRelativeTime(dateString, now = Date.now()) {
    if (!dateString) return 'Date inconnue';

    const published = new Date(dateString).getTime();
    if (isNaN(published)) return 'Date invalide';

    const diff = now - published;
    if (diff < 0) return 'Prochainement'; // Scheduled premiere

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const ago = (count, singular, plural = `${singular}s`) => `il y a ${count} ${count > 1 ? plural : singular}`;

    if (days >= 365) return ago(Math.floor(days / 365), 'an');
    if (days >= 30) return ago(Math.floor(days / 30), 'mois', 'mois');
    if (days >= 7) return ago(Math.floor(days / 7), 'semaine');
    if (days > 0) return ago(days, 'jour');
    if (hours > 0) return ago(hours, 'heure');
    if (minutes > 0) return ago(minutes, 'minute');
    return ago(Math.max(seconds, 1), 'seconde');
}
