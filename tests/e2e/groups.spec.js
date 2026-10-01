import { FakeYouTube } from './fake-youtube.js';
import { expect, feedCards, openApp, readStorage, signedIn, test } from './fixtures.js';

const dialog = page => page.locator('#groups-modal');
const chips = page => page.locator('.filter-button');

async function toggleChannel(page, channelName) {
    await page.locator('#channel-list .channel-checkbox', { hasText: channelName }).locator('input').click();
}

test.beforeEach(async ({ page }) => {
    page.on('dialog', confirmDialog => confirmDialog.accept());
    await openApp(page, signedIn());
    await expect(feedCards(page)).toHaveCount(15);
});

test('creates a group, refuses a duplicate name and filters the feed', async ({ page }) => {
    await page.locator('#manage-groups-button').click();

    // No group yet: an empty list, nothing to export
    await expect(page.locator('#groups-list')).toContainText('Aucun groupe');
    await expect(page.locator('#export-groups')).toBeDisabled();
    await page.locator('#new-group').click();
    await expect(page.locator('#groups-modal-title')).toHaveText('Nouveau groupe');
    await expect(page.locator('#delete-group')).toBeHidden();

    await page.locator('#channel-search').fill('chaine b');
    await expect(page.locator('#channel-list .channel-checkbox:visible')).toHaveText(['Chaîne B']);
    await page.locator('#channel-search').fill('');

    await toggleChannel(page, 'Chaîne B');
    await expect(page.locator('#selected-count')).toHaveText('1 sélectionnée');
    await page.locator('#group-name').fill('Tech');
    await page.locator('#save-group').click();

    await expect(page.locator('#groups-modal-title')).toHaveText('Gérer les groupes');
    await expect(page.locator('#groups-list .group-item')).toHaveText([/Tech\s*1 chaîne/]);
    await expect(chips(page)).toHaveText(['Tous', 'Tech']);

    await page.locator('#new-group').click();
    await page.locator('#group-name').fill(' Tech ');
    await toggleChannel(page, 'Chaîne A');
    await page.locator('#save-group').click();
    await expect(page.locator('#error-message')).toHaveText('Un groupe nommé « Tech » existe déjà');
    await expect(page.locator('#group-editor')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await chips(page).filter({ hasText: 'Tech' }).click();
    await expect(feedCards(page)).toHaveCount(5);
});

test('renames a group in place and keeps it selected, then deletes it', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('yt_user_groups', JSON.stringify({ Tech: ['UC_B'], Musique: ['UC_C'] })));
    await page.reload();
    await chips(page).filter({ hasText: 'Tech' }).click();
    await expect(feedCards(page)).toHaveCount(5);

    await page.locator('#manage-groups-button').click();
    await page.locator('#groups-list .group-open', { hasText: 'Tech' }).click();
    await expect(page.locator('#groups-modal-title')).toHaveText('Modifier le groupe');
    await expect(page.locator('#group-name')).toHaveValue('Tech');
    await expect(page.locator('#channel-list input:checked')).toHaveCount(1);

    await page.locator('#group-name').fill('Techno');
    await toggleChannel(page, 'Chaîne A');
    await page.locator('#save-group').click();

    expect(await readStorage(page, 'yt_user_groups')).toEqual({ Techno: ['UC_A', 'UC_B'], Musique: ['UC_C'] });
    await expect(chips(page)).toHaveText(['Tous', 'Techno', 'Musique']);
    await expect(page.locator('.filter-button.active')).toHaveText('Techno');
    await expect(feedCards(page)).toHaveCount(10);

    await page.locator('#groups-list .group-item', { hasText: 'Techno' }).getByRole('button', { name: 'Supprimer Techno' }).click();
    expect(await readStorage(page, 'yt_user_groups')).toEqual({ Musique: ['UC_C'] });
    await expect(page.locator('.filter-button.active')).toHaveText('Tous');
    await expect(feedCards(page)).toHaveCount(15);
});

test('exports the groups to a file that imports them back on another device', async ({ page, browser }) => {
    await page.evaluate(() => localStorage.setItem('yt_user_groups', JSON.stringify({ Tech: ['UC_A', 'UC_B'], Musique: ['UC_C'] })));
    await page.reload();
    await page.locator('#manage-groups-button').click();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-groups').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^groupes-global-video-feed-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf8')));
    expect(file.groups).toEqual([
        { name: 'Tech', channels: [{ id: 'UC_A', name: 'Chaîne A' }, { id: 'UC_B', name: 'Chaîne B' }] },
        { name: 'Musique', channels: [{ id: 'UC_C', name: 'Chaîne C' }] }
    ]);
    expect(file.subscriptions).toEqual([
        { id: 'UC_A', name: 'Chaîne A' }, { id: 'UC_B', name: 'Chaîne B' }, { id: 'UC_C', name: 'Chaîne C' }
    ]);

    // Another device: an empty browser, with one group already named like an imported one
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await new FakeYouTube().install(other);
    const otherPage = await other.newPage();
    await openApp(otherPage, { ...signedIn(), yt_user_groups: { Musique: ['UC_X'] } });
    await otherPage.locator('#manage-groups-button').click();
    await otherPage.locator('#import-groups-file').setInputFiles({
        name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file))
    });

    await expect(otherPage.locator('#error-message')).toHaveText('Import terminé : 1 groupe ajouté, 1 groupe complété.');
    expect(await readStorage(otherPage, 'yt_user_groups')).toEqual({ Musique: ['UC_X', 'UC_C'], Tech: ['UC_A', 'UC_B'] });
    await expect(otherPage.locator('.filter-button')).toHaveText(['Tous', 'Musique', 'Tech']);

    await otherPage.locator('#import-groups-file').setInputFiles({
        name: 'groupes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file))
    });
    await expect(otherPage.locator('#error-message')).toHaveText('Aucun nouveau groupe ni nouvelle chaîne à importer.');

    await otherPage.locator('#import-groups-file').setInputFiles({
        name: 'autre.json', mimeType: 'application/json', buffer: Buffer.from('{"foo": 1}')
    });
    await expect(otherPage.locator('#error-message')).toContainText('pas un export de groupes');
    await other.close();
});

test('the dialog closes on a click outside', async ({ page }) => {
    await page.locator('#manage-groups-button').click();
    await expect(dialog(page)).toBeVisible();

    await dialog(page).click({ position: { x: 5, y: 5 } });
    await expect(dialog(page)).toBeHidden();
});
