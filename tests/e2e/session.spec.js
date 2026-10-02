import { expect, expiredSessionWithCache, feedCards, openApp, readStorage, test } from './fixtures.js';

test('with an expired session, the cached feed is shown without calling the API', async ({ page, youtube }) => {
    await openApp(page, expiredSessionWithCache());

    await expect(feedCards(page)).toHaveCount(3);
    await expect(page.locator('#authorize-button')).toBeVisible();
    await expect(page.locator('#account')).toBeHidden();
    await page.waitForTimeout(800);
    expect(youtube.calls).toHaveLength(0);

    // Group filters work offline
    await page.locator('.filter-button', { hasText: 'Groupe A' }).click();
    await expect(feedCards(page)).toHaveCount(2);
});

test('reconnecting skips the consent screen and keeps the active filter', async ({ page, youtube }) => {
    await openApp(page, expiredSessionWithCache());
    await page.locator('.filter-button', { hasText: 'Groupe A' }).click();

    await page.locator('#authorize-button').click();

    await expect(page.locator('#account')).toBeVisible();
    expect(await page.evaluate(() => window.__gis.tokenRequests)).toEqual([{ prompt: '' }]);
    await expect(page.locator('.filter-button.active')).toHaveText('Groupe A');
    expect(youtube.calls.every(call => call.auth === 'Bearer token-from-popup')).toBe(true);
    expect((await readStorage(page, 'yt_auth_token')).access_token).toBe('token-from-popup');
});

test('buttons are wired once, even when the Google script loads late', async ({ page, youtube }) => {
    // While waiting for the Google script, the app used to wire every button again every 100 ms.
    // Listener registrations are counted: duplicates of a same function would be ignored by the
    // browser, and a toggle wired twice could look fine, so behaviour alone would not tell
    await page.addInitScript(() => {
        const counts = {};
        const addEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if (this instanceof Element && this.id) {
                const key = `${this.id} ${type}`;
                counts[key] = (counts[key] || 0) + 1;
            }
            return addEventListener.call(this, type, listener, options);
        };
        window.__listenerCounts = counts;
    });
    youtube.gisDelay = 1500;
    await openApp(page, expiredSessionWithCache());

    const counts = await page.evaluate(() => window.__listenerCounts);
    for (const id of ['authorize-button', 'signout-button', 'force-sync-button', 'guide-button', 'account-button',
        'new-group', 'add-selected', 'delete-group', 'import-history', 'drive-sync-toggle']) {
        expect(counts[`${id} click`], id).toBe(1);
    }
    expect(counts['search-input input']).toBe(1);

    await page.locator('#authorize-button').click();
    await expect(page.locator('#account')).toBeVisible();
    expect(await page.evaluate(() => window.__gis.tokenRequests)).toHaveLength(1);
});

test('the sign-in button waits for the Google script instead of failing', async ({ page, youtube }) => {
    youtube.gisDelay = 1500;
    await openApp(page, expiredSessionWithCache(), '/', { waitUntil: 'domcontentloaded' });

    await page.locator('#authorize-button').click();
    await expect(page.locator('#error-message')).toContainText('pas encore chargé');

    await page.waitForTimeout(1500);
    await page.locator('#authorize-button').click();
    await expect(page.locator('#account')).toBeVisible();
});
