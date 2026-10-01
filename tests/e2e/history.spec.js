import { comeBackToTab, expect, feedCards, feedTitles, openApp, readStorage, signedIn, test } from './fixtures.js';

const HOUR = 3600 * 1000;
const historyItems = page => page.locator('#history-list .history-item .video-title');
const toastAction = page => page.locator('#error-message .toast-action');

test.beforeEach(async ({ page }) => {
    page.on('dialog', confirmDialog => confirmDialog.accept());
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
});

test('an opened video is dimmed, then leaves the feed when coming back to the tab', async ({ page }) => {
    const first = await feedTitles(page).first().textContent();

    await feedCards(page).first().locator('.video-title-link').click();
    await expect(feedCards(page).first()).toHaveClass(/watched/);
    await expect(feedCards(page)).toHaveCount(15); // The grid does not move meanwhile

    await feedCards(page).nth(1).locator('a.thumbnail').click({ button: 'middle' });
    expect(Object.keys(await readStorage(page, 'yt_watch_history'))).toHaveLength(2);

    await comeBackToTab(page);
    await expect(feedCards(page)).toHaveCount(13);
    await expect(feedTitles(page)).not.toContainText([first]);
});

test('the card button hides a video right away, with "Annuler"', async ({ page }) => {
    await feedCards(page).first().hover();
    await feedCards(page).first().getByRole('button', { name: 'Marquer comme vue' }).click();

    await expect(feedCards(page)).toHaveCount(14);
    await expect(page.locator('#error-message')).toContainText('Vidéo marquée comme vue');
    await toastAction(page).click();
    await expect(feedCards(page)).toHaveCount(15);
});

test('the history page groups videos by day, searches, removes and clears them', async ({ page }) => {
    const now = Date.now();
    const cache = await readStorage(page, 'yt_video_cache');
    const videos = Object.entries(cache).flatMap(([channelId, list]) => list.map(video => ({ ...video, channelId })));
    const history = Object.fromEntries([0, 1, 30, 80].map((hoursAgo, index) => [
        videos[index].videoId, { watchedAt: now - hoursAgo * HOUR - 60 * 1000, video: videos[index] }
    ]));
    await page.evaluate(value => localStorage.setItem('yt_watch_history', JSON.stringify(value)), history);

    await page.locator('.guide .nav-link', { hasText: 'Historique' }).click();
    await expect(page).toHaveURL(/#historique$/);
    await expect(page.locator('#feed-view')).toBeHidden();
    await expect(page.locator('.history-day').first()).toHaveText('Aujourd\'hui');
    await expect(historyItems(page)).toHaveCount(4);
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Rechercher dans l\'historique');

    await page.locator('#search-input').fill(videos[2].title);
    await expect(historyItems(page)).toHaveText([videos[2].title]);
    await page.locator('#search-input').fill('');

    await page.locator('#history-list .history-item').first().getByRole('button', { name: 'Retirer de l\'historique' }).click();
    await expect(historyItems(page)).toHaveCount(3);
    await toastAction(page).click();
    await expect(historyItems(page)).toHaveCount(4);

    await page.locator('#clear-history').click();
    await expect(historyItems(page)).toHaveCount(0);
    await expect(page.locator('#history-list .no-videos')).toContainText('apparaissent ici');

    await page.locator('.guide .nav-link', { hasText: 'Accueil' }).click();
    await expect(feedCards(page)).toHaveCount(15);
});

test('imports a Google Takeout history and hides the imported feed videos', async ({ page }) => {
    const now = Date.now();
    const record = (videoId, title, hoursAgo, extra = {}) => ({
        header: 'YouTube',
        title: `Vous avez regardé ${title}`,
        titleUrl: `https://www.youtube.com/watch?v=${videoId}`,
        subtitles: [{ name: 'Une chaîne', url: 'https://www.youtube.com/channel/UCsomething' }],
        time: new Date(now - hoursAgo * HOUR).toISOString(),
        products: ['YouTube'],
        ...extra
    });
    const takeout = [
        record('UC_A_v0', 'Vidéo 1 de UC_A', 2),
        record('UC_B_v1', 'Vidéo 2 de UC_B', 30),
        record('dQw4w9WgXcQ', 'Never Gonna Give You Up', 100),
        record('UC_A_v0', 'Vidéo 1 de UC_A', 200),
        record('adadadadada', 'Une publicité', 1, { details: [{ name: 'Annonces Google' }] })
    ];
    const upload = (name, content) => page.locator('#import-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });

    await page.goto('/#historique');
    await upload('watch-history.json', JSON.stringify(takeout));

    await expect(page.locator('#error-message')).toHaveText('3 vidéos importées depuis YouTube, dont 2 retirées du fil.');
    await expect(historyItems(page)).toHaveText(['Vidéo 1 de UC_A', 'Vidéo 2 de UC_B', 'Never Gonna Give You Up']);
    await expect(page.locator('#history-list img[src*="dQw4w9WgXcQ"]')).toHaveAttribute('src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');

    await upload('watch-history.json', JSON.stringify(takeout));
    await expect(page.locator('#error-message')).toHaveText('Aucune nouvelle vidéo à importer.');

    await upload('watch-history.html', '<html><body>Vous avez regardé…</body></html>');
    await expect(page.locator('#error-message')).toContainText('format JSON');

    await page.goto('/');
    await expect(feedCards(page)).toHaveCount(13);
});
