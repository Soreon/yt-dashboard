// YouTube Data API v3, authenticated with the OAuth access token

import { BATCH_SIZE, VIDEOS_PER_SYNC } from './config.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

// Raised when the access token is rejected (expired or revoked)
export class AuthError extends Error {}

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
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
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

// Latest items of a playlist (null if the request failed)
export async function fetchPlaylistVideos(playlistId, token) {
    try {
        const params = { part: 'snippet', playlistId, maxResults: String(VIDEOS_PER_SYNC) };
        const data = await apiFetch('playlistItems', params, token);
        return data.items || [];
    } catch (error) {
        if (error instanceof AuthError) throw error;
        console.error(`Error fetching playlist ${playlistId}:`, error);
        return null;
    }
}
