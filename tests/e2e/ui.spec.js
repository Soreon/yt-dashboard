import { cachedVideo, expect, expiredSessionWithCache, feedCards, openApp, readStorage, signedIn, test } from './fixtures.js';

const listButton = page => page.getByRole('button', { name: 'Affichage en liste' });
const gridButton = page => page.getByRole('button', { name: 'Affichage en grille' });

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

test('"Tout marquer comme vu" empties a filtered feed, with "Annuler", and leaves the history alone', async ({ page }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A'] } });
    await expect(feedCards(page)).toHaveCount(15);
    await expect(page.locator('#mark-all-watched')).toBeHidden(); // Not on "Tous"

    await page.locator('.filter-button', { hasText: 'Tech' }).click();
    await expect(feedCards(page)).toHaveCount(5);
    await expect(page.locator('#mark-all-watched')).toHaveAttribute('title', 'Marquer les 5 vidéos comme vues');
    await page.locator('#mark-all-watched').click();
    await expect(page.locator('#error-message')).toContainText('5 vidéos marquées comme vues');
    await expect(page.locator('.no-videos')).toHaveText('Vous êtes à jour : toutes les vidéos de ce fil ont été vues.');
    await expect(page.locator('#mark-all-watched')).toBeHidden();
    expect(await readStorage(page, 'yt_watched_ids')).toHaveLength(5);
    expect(await readStorage(page, 'yt_watch_history')).toBeNull();

    await page.locator('#error-message .toast-action').click();
    await expect(feedCards(page)).toHaveCount(5);
    expect(await readStorage(page, 'yt_watched_ids')).toEqual([]);
});

test('a long feed is shown a page at a time, the rest while scrolling down', async ({ page }) => {
    const storage = expiredSessionWithCache();
    storage.yt_video_cache = { UC_A: Array.from({ length: 120 }, (_, i) => cachedVideo('UC_A', i, i + 1)) };
    await openApp(page, storage);
    await expect(feedCards(page)).toHaveCount(48);
    await expect(page.locator('#video-count')).toHaveText('120');

    await feedCards(page).last().scrollIntoViewIfNeeded();
    await expect(feedCards(page)).toHaveCount(96);

    // Marking a video as watched down there renders the feed again without moving the page
    await feedCards(page).nth(60).hover();
    const scrolled = await page.evaluate(() => window.scrollY);
    await feedCards(page).nth(60).getByRole('button', { name: 'Marquer comme vue' }).click();
    await expect(page.locator('#video-count')).toHaveText('119');
    await expect(feedCards(page)).toHaveCount(96);
    expect(Math.abs(await page.evaluate(() => window.scrollY) - scrolled)).toBeLessThan(400);

    await feedCards(page).last().scrollIntoViewIfNeeded();
    await expect(feedCards(page)).toHaveCount(119);
    await expect(page.locator('.feed-more')).toHaveCount(0);

    // A search, back at the top, starts again from the first page
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#search-input').fill('UC_A');
    await expect(feedCards(page)).toHaveCount(48);
});

test('the feed switches to a compact list, and the choice is remembered', async ({ page }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await expect(gridButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(listButton(page)).toHaveAttribute('aria-pressed', 'false');
    const cardHeight = (await feedCards(page).first().boundingBox()).height;

    await listButton(page).click();
    await expect(page.locator('#subscriptions-grid')).toHaveClass('video-list');
    await expect(listButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(gridButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await readStorage(page, 'yt_feed_layout')).toBe('list');

    // One video per row, far shorter than a card
    const first = await feedCards(page).nth(0).boundingBox();
    const second = await feedCards(page).nth(1).boundingBox();
    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    expect(first.height).toBeLessThan(cardHeight / 2);

    await page.reload();
    await expect(feedCards(page)).toHaveCount(15);
    await expect(page.locator('#subscriptions-grid')).toHaveClass('video-list');

    await gridButton(page).click();
    await expect(page.locator('#subscriptions-grid')).toHaveClass('video-grid');
    expect(await readStorage(page, 'yt_feed_layout')).toBe('grid');
});

test.describe('on a wide screen', () => {
    test.use({ viewport: { width: 1600, height: 900 } });

    test('the list shows title, channel, views and date in aligned columns', async ({ page }) => {
        await openApp(page, { ...signedIn(), yt_feed_layout: '"list"' }); // Stored as JSON
        await expect(feedCards(page)).toHaveCount(15);

        // Left edge of each column: the same on every row, in this order
        const columns = [];
        for (const selector of ['.video-title', '.channel-name', '.video-views', '.video-age']) {
            const lefts = await feedCards(page).locator(selector).evaluateAll(
                elements => elements.map(element => Math.round(element.getBoundingClientRect().left)));
            expect(new Set(lefts).size, selector).toBe(1);
            columns.push(lefts[0]);
        }
        expect(columns).toEqual([...columns].sort((a, b) => a - b));
    });

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

    test('the list fits the screen too', async ({ page }) => {
        await openApp(page, signedIn());
        await expect(feedCards(page)).toHaveCount(15);

        await listButton(page).tap();
        await expect(page.locator('#subscriptions-grid')).toHaveClass('video-list');
        await expect(feedCards(page).first().locator('.video-title')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});
