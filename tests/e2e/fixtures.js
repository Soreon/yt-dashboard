// Shared helpers for the end-to-end tests

import { test as base, expect } from '@playwright/test';
import { FakeYouTube } from './fake-youtube.js';

export { expect };

const HOUR = 3600 * 1000;

// Every test gets a fake YouTube (`youtube`) answering the page's requests, even when the test
// does not use it directly (auto fixture: without it, the page would try the real network)
export const test = base.extend({
    youtube: [async ({ context }, use) => {
        const youtube = new FakeYouTube();
        await youtube.install(context);

        // Videos open in a new tab (youtube.com, unreachable here): close those tabs right away
        context.on('page', opened => {
            if (context.pages().length > 1) opened.close().catch(() => {});
        });

        await use(youtube);
    }, { auto: true }]
});

export function validToken(expiresIn = HOUR) {
    return { access_token: 'stored-token', expires_in: 3599, expires_at: Date.now() + expiresIn };
}

export function expiredToken() {
    return { access_token: 'stored-token', expires_in: 3599, expires_at: Date.now() - 60 * 1000 };
}

// Signed in with a valid token, on the current cache format
export function signedIn() {
    return { yt_auth_token: validToken(), yt_cache_version: 2 };
}

// A cached video, as stored by the app
export function cachedVideo(channelId, index, hoursAgo, extra = {}) {
    return {
        videoId: `${channelId}_v${index}`,
        title: `Vidéo en cache ${index} de ${channelId}`,
        channelTitle: `Chaîne ${channelId.slice(3)}`,
        publishedAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
        thumbnail: '',
        duration: 600,
        views: 1200,
        ...extra
    };
}

// Expired session with a cached feed: the app shows it without calling the API
export function expiredSessionWithCache() {
    return {
        yt_auth_token: expiredToken(),
        yt_cache_version: 2,
        yt_video_cache: { UC_A: [cachedVideo('UC_A', 0, 5), cachedVideo('UC_A', 1, 30)], UC_B: [cachedVideo('UC_B', 0, 10)] },
        yt_playlist_cache: { UC_A: 'UU_A', UC_B: 'UU_B', UC_C: 'UU_C' },
        yt_channel_names: { UC_A: 'Chaîne A', UC_B: 'Chaîne B', UC_C: 'Chaîne C' },
        yt_user_groups: { 'Groupe A': ['UC_A'] },
        yt_last_sync: Date.now()
    };
}

// Open the app with the given localStorage content (JSON-encoded unless already a string).
// By default waits for the "load" event, which also waits for the (fake) Google script
export async function openApp(page, storage = {}, path = '/', { waitUntil = 'load' } = {}) {
    await page.goto('/favicon.svg');
    await page.evaluate(entries => {
        localStorage.clear();
        entries.forEach(([key, value]) => {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        });
    }, Object.entries(storage));
    await page.goto(path, { waitUntil });
}

export function readStorage(page, key) {
    return page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) ?? 'null'), key);
}

export function writeStorage(page, key, value) {
    return page.evaluate(([storageKey, json]) => localStorage.setItem(storageKey, json), [key, JSON.stringify(value)]);
}

// The user comes back to the tab
export function comeBackToTab(page) {
    return page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

export function feedCards(page) {
    return page.locator('#subscriptions-grid .video-card');
}

export function feedTitles(page) {
    return page.locator('#subscriptions-grid .video-title');
}

// Wait until no sync is running (the sync icon stops spinning)
export async function waitForSync(page) {
    await expect(page.locator('#force-sync-button')).not.toHaveClass(/spinning/);
}
