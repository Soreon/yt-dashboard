import { expect, feedCards, openApp, readStorage, signedIn, test } from './fixtures.js';

// Time a set of yt_sync_stamps records for an element ({ time: [elements] }), or null
async function stampOf(page, set, element) {
    const stamps = await readStorage(page, 'yt_sync_stamps');
    const found = Object.entries(stamps?.[set] || {}).find(([, elements]) => elements.includes(element));
    return found ? Number(found[0]) : null;
}

test('changes to the groups and the watched videos are stamped, for the other devices', async ({ page }) => {
    const before = Date.now();
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A'] } });
    await expect(feedCards(page)).toHaveCount(15);
    expect(await readStorage(page, 'yt_sync_stamps')).toBeNull(); // Nothing changed yet

    // Marked as watched, then "Annuler": both changes are stamped, the second one later
    const link = await feedCards(page).first().locator('.video-title-link').getAttribute('href');
    const videoId = new URL(link).searchParams.get('v');
    await feedCards(page).first().hover();
    await feedCards(page).first().getByRole('button', { name: 'Marquer comme vue' }).click();
    const watchedAt = await stampOf(page, 'watched', videoId);
    expect(watchedAt).toBeGreaterThanOrEqual(before);
    await page.locator('#error-message .toast-action').click();
    expect(await stampOf(page, 'watched', videoId)).toBeGreaterThan(watchedAt);

    // A channel added to a group, a group hidden
    await page.goto('/#groupe/Tech');
    await page.locator('#add-channels').click();
    await page.locator('#channel-list .channel-checkbox', { hasText: 'Chaîne B' }).locator('input').check();
    await page.locator('#add-selected').click();
    expect(await stampOf(page, 'members', 'UC_B/Tech')).toBeGreaterThan(watchedAt);
    expect(await stampOf(page, 'members', 'UC_A/Tech')).toBeNull();

    await page.goto('/#groupes');
    const techMenu = page.locator('.group-card-wrap', { hasText: 'Tech' }).locator('.card-menu');
    await techMenu.locator('summary').click();
    await techMenu.locator('.menu-item', { hasText: 'Masquer dans le fil' }).click();
    expect(await stampOf(page, 'hidden', 'Tech')).toBeGreaterThan(watchedAt);
});

test('videos only in an older history join the list of watched videos', async ({ page }) => {
    const history = { old_video: { watchedAt: Date.now() - 1000, video: { videoId: 'old_video', title: 'Ancienne' } } };
    await openApp(page, { ...signedIn(), yt_watch_history: history, yt_watched_ids: ['other'] });
    await expect(feedCards(page)).toHaveCount(15);

    expect(await readStorage(page, 'yt_watched_ids')).toEqual(['other', 'old_video']);
});
