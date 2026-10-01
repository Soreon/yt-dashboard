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

    // No group yet: straight to the editor
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

test('the dialog closes on a click outside', async ({ page }) => {
    await page.locator('#manage-groups-button').click();
    await expect(dialog(page)).toBeVisible();

    await dialog(page).click({ position: { x: 5, y: 5 } });
    await expect(dialog(page)).toBeHidden();
});
