// Configuration
// Google Identity Services (Token Model) - No backend secret required

export const CLIENT_ID = '595852680736-bde0rog3cine1u63lh1k3q53u1l5orlv.apps.googleusercontent.com'; // Replace with your OAuth Client ID
export const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'; // Only when the Drive sync is on

export const BATCH_SIZE = 50; // Max IDs per channels.list request
export const VIDEOS_PER_SYNC = 5; // Videos fetched per channel on each sync
export const MAX_VIDEOS_PER_CHANNEL = 10; // Videos kept per channel in the cache
export const SYNC_INTERVAL_MS = 30 * 60 * 1000; // Minimum delay between automatic syncs
export const AUTO_SYNC_CHECK_MS = 5 * 60 * 1000; // How often an open tab checks whether to sync
export const MAX_HISTORY = 500; // Watched videos kept in the history
export const DRIVE_SYNC_DELAY_MS = 10 * 1000; // Pause after a change before sending it to Drive
