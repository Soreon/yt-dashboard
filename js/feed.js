// Feed logic: pure functions, without DOM or storage access (see tests/)

import {
    CATCH_UP_AFTER_MS, CATCH_UP_VIDEOS, KEEP_UNWATCHED_MS, MAX_KEPT_PER_CHANNEL, MAX_VIDEOS_PER_CHANNEL, VIDEOS_PER_SYNC
} from './config.js';

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

// Merge freshly fetched playlist items into a channel's cached videos: the most recent ones, plus
// the unwatched ones of the last weeks (isWatched(videoId)), so that none goes unseen
export function mergeChannelVideos(items, cachedVideos = [], { isWatched = () => true, now = Date.now() } = {}) {
    const cachedById = new Map(cachedVideos.map(video => [video.videoId, video]));

    // Fresh snippet data wins, details already known (duration, views) are kept
    const fetchedVideos = items
        .map(toCachedVideo)
        .filter(video => video.videoId)
        .map(video => ({ ...cachedById.get(video.videoId), ...video }));
    const fetchedVideoIds = new Set(fetchedVideos.map(video => video.videoId));

    // Keep older cached videos that were not returned again
    const olderVideos = cachedVideos.filter(video => !fetchedVideoIds.has(video.videoId));

    const videos = [...fetchedVideos, ...olderVideos];
    const unwatched = videos.slice(MAX_VIDEOS_PER_CHANNEL)
        .filter(video => !isWatched(video.videoId) && now - Date.parse(video.publishedAt) < KEEP_UNWATCHED_MS);
    return [...videos.slice(0, MAX_VIDEOS_PER_CHANNEL), ...unwatched].slice(0, MAX_KEPT_PER_CHANNEL);
}

// Number of videos to ask for a channel: more when it was last read long ago, so that nothing
// published meanwhile is missed (a request costs the same whatever the number)
export function videosToFetch(lastRead, now = Date.now()) {
    return lastRead && now - lastRead > CATCH_UP_AFTER_MS ? CATCH_UP_VIDEOS : VIDEOS_PER_SYNC;
}

// IDs of cached videos whose details (duration, views) were never fetched
export function videosMissingDetails(videoCache) {
    return Object.values(videoCache)
        .flat()
        .filter(video => video.duration === undefined)
        .map(video => video.videoId);
}

// Videos of the cache shown as live or upcoming: their details are refreshed at every sync, to
// follow them until they are over
export function videosLiveOrUpcoming(videoCache) {
    return Object.values(videoCache).flat().filter(video => video.live).map(video => video.videoId);
}

// Details of a video from the videos.list API (contentDetails, statistics, liveStreamingDetails):
// duration, views, and for a premiere or a live, whether it is upcoming (with its scheduled
// time) or live (with its viewers). Once over, it is a video like any other (live undefined)
export function videoDetailsFromApi(item) {
    const viewCount = item.statistics?.viewCount;
    const stream = item.liveStreamingDetails;
    let live;
    if (stream && !stream.actualEndTime) {
        if (stream.actualStartTime) {
            live = 'live';
        } else if (stream.scheduledStartTime) {
            live = 'upcoming';
        }
    }

    return {
        duration: parseIsoDuration(item.contentDetails?.duration),
        views: viewCount === undefined ? null : Number(viewCount),
        live,
        scheduledAt: live === 'upcoming' ? stream.scheduledStartTime : undefined,
        viewers: live === 'live' && stream.concurrentViewers !== undefined ? Number(stream.concurrentViewers) : undefined
    };
}

// Copy of the video cache with fetched details ({ videoId: { duration, views, live... } }) applied
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

// A count as YouTube words it in French, for a noun: "345 vues", "1,2 k vues", "3,4 M de vues".
// YouTube truncates (1 290 → "1,2 k") and keeps one decimal below 10 of the unit
function formatCount(count, singular, plural) {
    if (count === 1) return `1 ${singular}`;
    if (count < 1000) return `${count} ${plural}`;

    const compact = (value, unit) => {
        const shown = value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value);
        return `${String(shown).replace('.', ',')} ${unit}`;
    };

    if (count < 1e6) return `${compact(count / 1e3, 'k')} ${plural}`;
    if (count < 1e9) return `${compact(count / 1e6, 'M')} de ${plural}`;
    return `${compact(count / 1e9, 'Md')} de ${plural}`;
}

// View count as shown by YouTube in French: "345 vues", "1,2 k vues", "3,4 M de vues"
export function formatViews(views) {
    if (views === null || views === undefined) return '';
    if (views === 0) return 'Aucune vue';
    return formatCount(views, 'vue', 'vues');
}

// Viewers of a live: "1,2 k spectateurs", or just "En direct" when unknown
export function formatViewers(viewers) {
    return Number.isFinite(viewers) && viewers > 0 ? formatCount(viewers, 'spectateur', 'spectateurs') : 'En direct';
}

// Scheduled time of a premiere: "Prévue aujourd'hui à 18:00", "demain à 9:30", "le 12 oct. à 20:00"
export function formatScheduled(dateString, now = Date.now()) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Prochainement';

    const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
    const day = new Date(now);
    const tomorrow = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    let when;
    if (date.toDateString() === day.toDateString()) {
        when = 'aujourd\'hui';
    } else if (date.toDateString() === tomorrow.toDateString()) {
        when = 'demain';
    } else {
        when = `le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date)}`;
    }
    return `Prévue ${when} à ${time}`;
}

// Copy of a { channelId: value } map limited to the given channels
export function keepChannels(map, channelIds) {
    const kept = new Set(channelIds);
    return Object.fromEntries(Object.entries(map).filter(([channelId]) => kept.has(channelId)));
}

// Flatten the video cache into one list, optionally limited to some channels: what is live
// first, then the upcoming premieres (the soonest first), then the videos, newest first
export function buildFeed(videoCache, channelIds = null) {
    const allowed = channelIds ? new Set(channelIds) : null;
    const videos = [];

    Object.entries(videoCache).forEach(([channelId, channelVideos]) => {
        if (allowed && !allowed.has(channelId)) return;
        (channelVideos || []).forEach(video => videos.push({ ...video, channelId }));
    });

    const rank = video => ({ live: 0, upcoming: 1 }[video.live] ?? 2);
    return videos.sort((a, b) => {
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (rank(a) === 1) return (Date.parse(a.scheduledAt) || 0) - (Date.parse(b.scheduledAt) || 0);

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
