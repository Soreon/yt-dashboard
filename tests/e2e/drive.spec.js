import { comeBackToTab, expect, feedCards, openApp, readStorage, signedIn, test } from './fixtures.js';

const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const toggle = page => page.locator('#drive-sync-toggle');
const syncStatus = page => page.locator('#drive-sync-status');
const chips = page => page.locator('.filter-button');

async function openAccountMenu(page) {
    if (await page.locator('#account-menu').isHidden()) await page.locator('#account-button').click();
}

async function turnSyncOn(page) {
    await openAccountMenu(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    await expect(syncStatus(page)).toHaveText(/^Synchronisé il y a/);
    await page.keyboard.press('Escape');
}

// Mark the first video of the feed as watched; returns its ID
async function markFirstWatched(page) {
    const link = await feedCards(page).first().locator('.video-title-link').getAttribute('href');
    await feedCards(page).first().hover();
    await feedCards(page).first().getByRole('button', { name: 'Marquer comme vue' }).click();
    return new URL(link).searchParams.get('v');
}

test('turning the sync on asks Google for Drive, then saves the data there', async ({ page, youtube }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A'] } });
    await expect(feedCards(page)).toHaveCount(15);
    await openAccountMenu(page);
    await expect(syncStatus(page)).toHaveText('Désactivée');

    await turnSyncOn(page);
    expect(await page.evaluate(() => window.__gis.tokenRequests)).toEqual([{ prompt: '', scope: `${YOUTUBE_SCOPE} ${DRIVE_SCOPE}` }]);
    expect(youtube.driveFile().data.groups).toEqual({ Favoris: [], Tech: ['UC_A'] });
    expect(youtube.driveFiles.size).toBe(1);

    // A later change goes with the sync button, without waiting
    const videoId = await markFirstWatched(page);
    await page.locator('#force-sync-button').click();
    await expect.poll(() => youtube.driveFile().data.watchedIds).toContain(videoId);
    expect(youtube.driveFiles.size).toBe(1);

    // Signing in again later asks for Drive too, without turning the sync off
    await page.reload();
    await expect(feedCards(page)).toHaveCount(14);
    await openAccountMenu(page);
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
});

test('refusing Drive access keeps the sync off', async ({ page, youtube }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await page.evaluate(scope => window.__gis.refused.push(scope), DRIVE_SCOPE);

    await openAccountMenu(page);
    await toggle(page).click();
    await expect(page.locator('#error-message')).toHaveText('Accès à Google Drive refusé : la synchronisation reste désactivée.');
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(syncStatus(page)).toHaveText('Désactivée');
    expect(youtube.driveCalls).toHaveLength(0);
});

test('two devices share their groups and watched videos through Drive', async ({ page, youtube, browser }) => {
    test.slow(); // Two browsers
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A'] } });
    await expect(feedCards(page)).toHaveCount(15);
    await turnSyncOn(page);

    // The other device, with other groups: turning the sync on there adds both up
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await youtube.install(other);
    const phone = await other.newPage();
    await openApp(phone, { ...signedIn(), yt_user_groups: { Musique: ['UC_C'] } });
    await expect(feedCards(phone)).toHaveCount(15);
    await turnSyncOn(phone);
    await expect(chips(phone)).toHaveText(['Tous', 'Favoris', 'Musique', 'Tech']);

    // Back on the first device: it gets them too
    await comeBackToTab(page);
    await expect(chips(page)).toHaveText(['Tous', 'Favoris', 'Musique', 'Tech']);
    expect(await readStorage(page, 'yt_user_groups')).toEqual({ Favoris: [], Musique: ['UC_C'], Tech: ['UC_A'] });

    // A video watched on the phone leaves the feed of the first device
    const videoId = await markFirstWatched(phone);
    await phone.locator('#force-sync-button').click();
    await expect.poll(() => youtube.driveFile().data.watchedIds).toContain(videoId);
    await comeBackToTab(page);
    await expect(feedCards(page)).toHaveCount(14);
    expect(await readStorage(page, 'yt_watched_ids')).toContain(videoId);

    // A group deleted on the first device goes from the phone too
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/#groupe/Musique');
    await page.locator('#delete-group').click();
    await expect(page).toHaveURL(/#groupes$/);
    await page.locator('#force-sync-button').click();
    await expect.poll(() => Object.keys(youtube.driveFile().data.groups)).toEqual(['Favoris', 'Tech']);
    await comeBackToTab(phone);
    await expect(chips(phone)).toHaveText(['Tous', 'Favoris', 'Tech']);

    await other.close();
});

test('the sync stops when turned off, and signing out turns it off', async ({ page, youtube }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await turnSyncOn(page);
    const uploads = youtube.driveUploads();

    await openAccountMenu(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await markFirstWatched(page);
    await page.locator('#force-sync-button').click();
    await expect(page.locator('#force-sync-button')).not.toHaveClass(/spinning/);
    expect(youtube.driveUploads()).toBe(uploads);

    // On again (Drive already granted: no new popup), then signed out
    await openAccountMenu(page);
    await toggle(page).click();
    await expect(syncStatus(page)).toHaveText(/^Synchronisé il y a/);
    expect(await page.evaluate(() => window.__gis.tokenRequests)).toHaveLength(1);
    await expect.poll(() => youtube.driveUploads()).toBe(uploads + 1);

    await page.locator('#signout-button').click();
    expect(await readStorage(page, 'yt_drive_sync')).toBeNull();
});

test('a sync file left empty, or deleted from the Drive settings, is written again', async ({ page, youtube }) => {
    // A first upload that failed after creating the file
    youtube.driveFiles.set('file1', { name: 'global-video-feed.json', parents: ['appDataFolder'], version: 1, content: '' });
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A'] } });
    await expect(feedCards(page)).toHaveCount(15);
    await turnSyncOn(page);
    expect(youtube.driveFile().data.groups).toEqual({ Favoris: [], Tech: ['UC_A'] });

    youtube.driveFiles.clear();
    await page.locator('#force-sync-button').click();
    await expect.poll(() => youtube.driveFile()?.data.groups).toEqual({ Favoris: [], Tech: ['UC_A'] });
});

test('Drive access withdrawn from the Google account turns the sync off', async ({ page, youtube }) => {
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
    await turnSyncOn(page);

    youtube.driveFailure = { status: 403, json: { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } } };
    await page.locator('#force-sync-button').click();
    await expect(page.locator('#error-message')).toHaveText('Accès à Google Drive retiré : la synchronisation est désactivée.');
    await openAccountMenu(page);
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
});
