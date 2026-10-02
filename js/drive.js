// Google Drive API v3: the sync file, in the app's hidden folder (appDataFolder, scope drive.appdata)

import { AuthError } from './api.js';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SYNC_FILE_NAME = 'global-video-feed.json';

// Raised when the access token does not allow Drive (access refused or withdrawn)
export class DriveAccessError extends Error {}

// Authenticated request; returns the response, or null for a 404 when allowMissing is set
async function driveFetch(url, token, { allowMissing = false, ...options } = {}) {
    const response = await fetch(url, {
        ...options,
        headers: { 'Authorization': `Bearer ${token}`, ...options.headers }
    });

    if (response.status === 401) {
        throw new AuthError('Session expirée');
    }
    if (response.status === 404 && allowMissing) {
        return null;
    }
    if (response.status === 403) {
        const body = await response.json().catch(() => ({}));
        const reason = body.error?.errors?.[0]?.reason || body.error?.status || '';
        if (/insufficient|scope/i.test(reason) || /scope/i.test(body.error?.message || '')) {
            throw new DriveAccessError('Accès à Google Drive non autorisé');
        }
    }
    if (!response.ok) {
        throw new Error(`Drive API Error: ${response.status} ${response.statusText}`);
    }
    return response;
}

// The sync file ({ id, version }), or null if there is none yet
export async function findSyncFile(token) {
    const url = new URL(FILES_URL);
    url.searchParams.set('spaces', 'appDataFolder');
    url.searchParams.set('q', `name = '${SYNC_FILE_NAME}' and trashed = false`);
    url.searchParams.set('fields', 'files(id,version)');
    const { files } = await (await driveFetch(url, token)).json();
    return files?.[0] || null;
}

// Version of the file (it increases with every change), or null if it no longer exists
export async function getFileVersion(fileId, token) {
    const url = new URL(`${FILES_URL}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', 'version');
    const response = await driveFetch(url, token, { allowMissing: true });
    return response ? (await response.json()).version : null;
}

// Content of the file, parsed as JSON, or null if it is empty (created, but never written)
export async function downloadFile(fileId, token) {
    const url = new URL(`${FILES_URL}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('alt', 'media');
    const text = await (await driveFetch(url, token)).text();
    return text.trim() ? JSON.parse(text) : null;
}

// Create the (empty) sync file in the hidden folder; returns its ID
export async function createSyncFile(token) {
    const url = new URL(FILES_URL);
    url.searchParams.set('fields', 'id');
    const response = await driveFetch(url, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: SYNC_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' })
    });
    return (await response.json()).id;
}

// Replace the content of the file; returns its new version
export async function uploadFile(fileId, content, token) {
    const url = new URL(`${UPLOAD_URL}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('uploadType', 'media');
    url.searchParams.set('fields', 'version');
    const response = await driveFetch(url, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content)
    });
    return (await response.json()).version;
}
