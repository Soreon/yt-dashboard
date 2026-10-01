// YouTube Data API v3, authenticated with the OAuth access token

import { BATCH_SIZE, VIDEOS_PER_SYNC } from './config.js';
import { longFormPlaylistId, parseIsoDuration } from './feed.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

// Raised when the access token is rejected (expired or revoked)
export class AuthError extends Error {}

// Raised on any other HTTP error
class ApiError extends Error {
    constructor(response) {
        super(`API Error: ${response.status} ${response.statusText}`);
        this.status = response.status;
    }
}

// Authenticated GET on an API endpoint
async function apiFetch(endpoint, params, token) {
    const url = new URL(`${API_BASE}/${endpoint}`);
    Object.entries(params).forEach(([name, value]) => url.searchParams.append(name, value));

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (response.status === 401) {
        throw new AuthError('Session expirée');
    }

    if (!response.ok) {
        throw new ApiError(response);
    }

    return response.json();
}

// Fetch all subscriptions, following pagination
export async function fetchAllSubscriptions(token) {
    const allSubscriptions = [];
    let nextPageToken = null;

    do {
        const params = { part: 'snippet', mine: 'true', maxResults: '50', order: 'alphabetical' };
        if (nextPageToken) {
            params.pageToken = nextPageToken;
        }

        const data = await apiFetch('subscriptions', params, token);
        allSubscriptions.push(...(data.items || []));
        nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    return allSubscriptions;
}

// Name and avatar of the signed-in user's channel ({ name, avatar }, null if unavailable)
export async function fetchMyChannel(token) {
    try {
        const data = await apiFetch('channels', { part: 'snippet', mine: 'true' }, token);
        const snippet = data.items?.[0]?.snippet;
        return snippet ? { name: snippet.title, avatar: snippet.thumbnails?.default?.url || '' } : null;
    } catch (error) {
        if (error instanceof AuthError) throw error;
        console.error('Error fetching account:', error);
        return null;
    }
}

// Uploads playlist of each channel, in batches of 50: { channelId: playlistId }
export async function fetchUploadsPlaylists(channelIds, token) {
    const playlists = {};

    for (let i = 0; i < channelIds.length; i += BATCH_SIZE) {
        const batch = channelIds.slice(i, i + BATCH_SIZE);
        try {
            const data = await apiFetch('channels', { part: 'contentDetails', id: batch.join(',') }, token);
            (data.items || []).forEach(channel => {
                const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
                if (playlistId) {
                    playlists[channel.id] = playlistId;
                }
            });
        } catch (error) {
            if (error instanceof AuthError) throw error;
            console.error('Error fetching batch:', error);
        }
    }

    return playlists;
}

// Duration (seconds) and view count of videos, in parallel batches of 50: { videoId: { duration, views } }
export async function fetchVideoDetails(videoIds, token) {
    const batches = [];
    for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
        batches.push(videoIds.slice(i, i + BATCH_SIZE));
    }

    const details = {};
    await Promise.all(batches.map(async batch => {
        try {
            const data = await apiFetch('videos', { part: 'contentDetails,statistics', id: batch.join(',') }, token);
            (data.items || []).forEach(video => {
                const viewCount = video.statistics?.viewCount;
                details[video.id] = {
                    duration: parseIsoDuration(video.contentDetails?.duration),
                    views: viewCount === undefined ? null : Number(viewCount)
                };
            });
        } catch (error) {
            if (error instanceof AuthError) throw error;
            console.error('Error fetching video details:', error);
        }
    }));

    return details;
}

// Latest items of a playlist
async function fetchPlaylistItems(playlistId, token) {
    const params = { part: 'snippet', playlistId, maxResults: String(VIDEOS_PER_SYNC) };
    const data = await apiFetch('playlistItems', params, token);
    return data.items || [];
}

// Latest videos of a channel without Shorts (null if the request failed)
export async function fetchLatestVideos(uploadsPlaylistId, token) {
    try {
        try {
            return await fetchPlaylistItems(longFormPlaylistId(uploadsPlaylistId), token);
        } catch (error) {
            // No long-form playlist for this channel: fall back to all uploads, Shorts included
            if (error.status !== 404) throw error;
            return await fetchPlaylistItems(uploadsPlaylistId, token);
        }
    } catch (error) {
        if (error instanceof AuthError) throw error;
        console.error(`Error fetching playlist ${uploadsPlaylistId}:`, error);
        return null;
    }
}
