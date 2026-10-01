import { cachedVideo, expect, expiredSessionWithCache, feedCards, openApp, signedIn, test } from './fixtures.js';

test('a malicious video title cannot inject markup', async ({ page }) => {
    const storage = expiredSessionWithCache();
    storage.yt_video_cache.UC_A[0] = cachedVideo('UC_A', 0, 1, {
        title: 'Piège " onmouseover="window.__xss=1" data-x="',
        thumbnail: 'x" onerror="window.__xss=2'
    });
    await openApp(page, storage);

    const link = page.locator('.video-title-link').first();
    await expect(link).toHaveAttribute('title', 'Piège " onmouseover="window.__xss=1" data-x="');
    await link.hover();
    expect(await link.getAttribute('onmouseover')).toBeNull();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('the search box filters the feed, ignoring accents and case', async ({ page }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);

    await page.locator('#search-input').fill('CHAINE b');
    await expect(feedCards(page)).toHaveCount(5);
    await page.locator('#search-input').fill('vidéo 1 de uc_a');
    await expect(feedCards(page)).toHaveCount(1);
    await page.locator('#search-input').fill('zzz');
    await expect(page.locator('.no-videos')).toHaveText('Aucune vidéo ne correspond à « zzz ».');
});

test.describe('on a wide screen', () => {
    test.use({ viewport: { width: 1600, height: 900 } });

    test('the menu button collapses the guide, and the choice is remembered', async ({ page }) => {
        await openApp(page, signedIn());
        await expect(page.locator('.guide .guide-label', { hasText: 'Accueil' })).toBeVisible();

        await page.locator('#guide-button').click();
        await expect(page.locator('body')).toHaveClass(/guide-collapsed/);

        await page.reload();
        await expect(page.locator('body')).toHaveClass(/guide-collapsed/);
    });
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('the feed fits the screen and the bottom bar replaces the guide', async ({ page }) => {
        await openApp(page, signedIn());
        await expect(feedCards(page)).toHaveCount(15);

        await expect(page.locator('.guide')).toBeHidden();
        await expect(page.locator('.pivot-bar')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        await page.locator('.pivot-bar .nav-link', { hasText: 'Historique' }).tap();
        await expect(page.locator('#history-view')).toBeVisible();
    });
});
