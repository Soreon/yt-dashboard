// Feed logic: pure functions, without DOM or storage access (see tests/)

import { MAX_VIDEOS_PER_CHANNEL } from './config.js';

// Validate YouTube ID format (alphanumeric, underscore, hyphen)
export function isValidYouTubeId(id) {
    return Boolean(id) && /^[a-zA-Z0-9_-]+$/.test(id);
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
    const fetchedVideos = items.map(toCachedVideo).filter(video => video.videoId);
    const fetchedVideoIds = new Set(fetchedVideos.map(video => video.videoId));

    // Keep older cached videos that were not returned again
    const olderVideos = cachedVideos.filter(video => !fetchedVideoIds.has(video.videoId));

    return [...fetchedVideos, ...olderVideos].slice(0, MAX_VIDEOS_PER_CHANNEL);
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

// Format relative time
export function getRelativeTime(dateString, now = Date.now()) {
    if (!dateString) return 'Date inconnue';

    const published = new Date(dateString).getTime();
    if (isNaN(published)) return 'Date invalide';

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
