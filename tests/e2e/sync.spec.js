import {
    comeBackToTab, expect, feedCards, feedTitles, openApp, readStorage, signedIn, test, validToken, waitForSync,
    writeStorage
} from './fixtures.js';

const HOUR = 3600 * 1000;

test('loads the subscriptions, then syncs each channel once with the OAuth token only', async ({ page, youtube }) => {
    await openApp(page, signedIn());

    await expect(feedCards(page)).toHaveCount(15);
    await waitForSync(page);
    expect(youtube.count('subscriptions')).toBe(1);
    expect(youtube.count('playlistItems')).toBe(3);
    expect(youtube.count('videos')).toBe(1);
    expect(youtube.calls.every(call => call.auth === 'Bearer stored-token')).toBe(true);
    expect(youtube.calls.some(call => 'key' in call.params)).toBe(false);
});

test('one click on the sync button syncs each channel once', async ({ page, youtube }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await waitForSync(page);

    // The Google script loads late: the buttons must not have been wired several times
    await page.locator('#force-sync-button').click();
    await waitForSync(page);
    expect(youtube.count('playlistItems')).toBe(6);

    // Clicks during a sync do not start another one (three clicks in the same instant)
    await page.locator('#force-sync-button').evaluate(button => {
        button.click();
        button.click();
        button.click();
    });
    await waitForSync(page);
    expect(youtube.count('playlistItems')).toBe(9);
});

test('a sync where every request fails is not recorded as done', async ({ page, youtube }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await waitForSync(page);
    const lastSync = await readStorage(page, 'yt_last_sync');

    youtube.failures.playlistItems = 500;
    await page.locator('#force-sync-button').click();

    await expect(page.locator('#error-message')).toHaveText('Erreur lors de la synchronisation des vidéos');
    expect(await readStorage(page, 'yt_last_sync')).toBe(lastSync);
});

test('a 401 during a sync keeps the feed and offers to reconnect', async ({ page, youtube }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await waitForSync(page);

    youtube.failures.playlistItems = 401;
    await page.locator('#force-sync-button').click();

    await expect(page.locator('#error-message')).toHaveText('Session expirée. Reconnectez-vous pour mettre à jour le flux.');
    await expect(page.locator('#authorize-button')).toBeVisible();
    await expect(feedCards(page)).toHaveCount(15);
});

test('Shorts are left out, with a fallback when a long-form playlist is missing', async ({ page, youtube }) => {
    youtube.noLongForm.add('UC_C');
    await openApp(page, signedIn());

    await expect(feedCards(page)).toHaveCount(15);
    const playlists = youtube.calls.filter(call => call.endpoint === 'playlistItems').map(call => call.params.playlistId);
    expect(playlists.sort()).toEqual(['UULF_A', 'UULF_B', 'UULF_C', 'UU_C']);

    // Only the channel without long-form playlist shows Shorts
    const shorts = await feedTitles(page).filter({ hasText: '#Short' }).allTextContents();
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.every(title => title.endsWith('UC_C'))).toBe(true);
});

test('an old cache is rebuilt, and unsubscribed channels are forgotten', async ({ page }) => {
    const oldItem = (channelId, index) => ({
        snippet: { title: `Ancienne vidéo ${index}`, resourceId: { videoId: `${channelId}_old${index}` }, publishedAt: new Date().toISOString() }
    });
    await openApp(page, {
        yt_auth_token: validToken(),
        yt_video_cache: { UC_A: [oldItem('UC_A', 1)], UC_X: [oldItem('UC_X', 1)] },
        yt_playlist_cache: { UC_A: 'UU_A', UC_B: 'UU_B', UC_C: 'UU_C', UC_X: 'UU_X' },
        yt_last_sync: Date.now()
    });

    await expect(feedCards(page)).toHaveCount(15);
    const videoCache = await readStorage(page, 'yt_video_cache');
    expect(Object.keys(videoCache).sort()).toEqual(['UC_A', 'UC_B', 'UC_C']);
    expect(JSON.stringify(videoCache)).not.toContain('Ancienne');
    expect(Object.keys(await readStorage(page, 'yt_playlist_cache')).sort()).toEqual(['UC_A', 'UC_B', 'UC_C']);
    expect(await readStorage(page, 'yt_cache_version')).toBe(2);
});

test('the automatic sync waits 30 minutes, and does not move the feed when scrolled down', async ({ page, youtube }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await waitForSync(page);

    // Synced at load: coming back to the tab does not sync again
    await comeBackToTab(page);
    await waitForSync(page);
    expect(youtube.count('playlistItems')).toBe(3);

    // At the top of the page, new videos show up right away
    youtube.publishVideo('UC_A_n0');
    await writeStorage(page, 'yt_last_sync', Date.now() - 31 * 60 * 1000);
    await comeBackToTab(page);
    await expect(feedTitles(page).first()).toHaveText('Nouvelle vidéo UC_A_n0');

    // Scrolled down, a pill offers them instead
    await page.evaluate(() => window.scrollTo(0, 600));
    youtube.publishVideo('UC_A_n1');
    await writeStorage(page, 'yt_last_sync', Date.now() - 31 * 60 * 1000);
    await comeBackToTab(page);
    await expect(page.locator('#new-videos-pill')).toBeVisible();
    await expect(feedTitles(page).first()).toHaveText('Nouvelle vidéo UC_A_n0');

    await page.locator('#new-videos-pill').click();
    await expect(feedTitles(page).first()).toHaveText('Nouvelle vidéo UC_A_n1');
    await expect(page.locator('#new-videos-pill')).toBeHidden();
});

test('an expired token stops the automatic sync without calling the API', async ({ page, youtube }) => {
    // A token valid for a few seconds: long enough to load, short enough for the test
    await openApp(page, { yt_auth_token: validToken(6000), yt_cache_version: 2 });
    await expect(feedCards(page)).toHaveCount(15);
    await waitForSync(page);

    await page.waitForTimeout(6000);
    const callsBefore = youtube.calls.length;
    await comeBackToTab(page);

    await expect(page.locator('#authorize-button')).toBeVisible();
    await expect(page.locator('#error-message')).toContainText('Session expirée');
    await expect(feedCards(page)).toHaveCount(15);
    expect(youtube.calls.length).toBe(callsBefore);
});

test('views and durations are shown like on YouTube', async ({ page }) => {
    await openApp(page, signedIn());
    const card = feedCards(page).first();

    await expect(card.locator('.duration-badge')).toHaveText(/^\d+:\d{2}$/);
    await expect(card.locator('.video-stats')).toHaveText(/k vues.*il y a \d+ heures?/);
    await expect(card.locator('.channel-name')).toHaveAttribute('href', 'https://www.youtube.com/channel/UC_A');
});

test('the masthead shows the account, and the menu signs out', async ({ page }) => {
    await openApp(page, signedIn());
    await expect(page.locator('#account')).toBeVisible();

    await page.locator('#account-button').click();
    await expect(page.locator('#account-name')).toHaveText('Jean Testeur');
    await page.locator('#signout-button').click();

    await expect(page.locator('#authorize-button')).toBeVisible();
    await expect(feedCards(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__gis.revoked)).toEqual(['stored-token']);
    expect(await readStorage(page, 'yt_auth_token')).toBeNull();
});

test('after signing out, a reload does not show the feed', async ({ page }) => {
    await openApp(page, signedIn());
    await page.locator('#account-button').click();
    await page.locator('#signout-button').click();

    await page.reload();
    await page.waitForTimeout(800);
    await expect(feedCards(page)).toHaveCount(0);
    await expect(page.locator('#authorize-button')).toBeVisible();
});

test('the last sync time is ignored by a forced sync', async ({ page, youtube }) => {
    await openApp(page, { ...signedIn(), yt_last_sync: Date.now() - HOUR / 60 });
    await page.waitForTimeout(800);
    expect(youtube.count('playlistItems')).toBe(0);

    await page.locator('#force-sync-button').click();
    await expect(feedCards(page)).toHaveCount(15);
    expect(youtube.count('playlistItems')).toBe(3);
});
