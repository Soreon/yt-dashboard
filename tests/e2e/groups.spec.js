import { FakeYouTube } from './fake-youtube.js';
import { expect, feedCards, openApp, readStorage, signedIn, test } from './fixtures.js';

const chips = page => page.locator('.filter-button');
const cards = page => page.locator('#groups-grid .group-card');
const rows = page => page.locator('#group-channels .channel-row');
const rowOf = (page, channelName) => rows(page).filter({ has: page.locator('.channel-row-name', { hasText: channelName }) });

async function openRowMenu(page, channelName) {
    await rowOf(page, channelName).locator('summary').click();
    return rowOf(page, channelName).locator('.row-menu-items');
}

async function checkChannel(page, channelName) {
    await page.locator('#channel-list .channel-checkbox', { hasText: channelName }).locator('input').check();
}

test.beforeEach(async ({ page }) => {
    page.on('dialog', confirmDialog => confirmDialog.accept());
});

test('the groups page shows one card per group, and opens a group', async ({ page }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A', 'UC_B'], Musique: ['UC_C'] } });
    await expect(feedCards(page)).toHaveCount(15);

    await page.locator('.guide .nav-link', { hasText: 'Groupes' }).click();
    await expect(page).toHaveURL(/#groupes$/);
    await expect(page.locator('#feed-view')).toBeHidden();
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).first()).toContainText('Tech');
    await expect(cards(page).first()).toContainText('2 chaînes');
    await expect(cards(page).first()).toContainText('non vues');
    await expect(cards(page).first().locator('.group-mosaic .avatar')).toHaveCount(2);
    await expect(page.locator('#ungrouped-count')).toHaveText('0');

    await cards(page).first().click();
    await expect(page).toHaveURL(/#groupe\/Tech$/);
    await expect(page.locator('#group-title')).toHaveText('Tech');
    await expect(page.locator('#group-meta')).toContainText('2 chaînes');
    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne A', 'Chaîne B']);
    await expect(rows(page).first().locator('.group-meta')).toContainText('dernière vidéo il y a');

    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/#groupes$/);
});

test('creates a group, adds channels to it, renames it and deletes it', async ({ page }) => {
    await openApp(page, signedIn(), '/#groupes');
    await expect(page.locator('#groups-grid')).toContainText('Aucun groupe');
    await expect(page.locator('#export-groups')).toBeDisabled();
    await expect(page.locator('#ungrouped-count')).toHaveText('3');

    await page.locator('#new-group').click();
    await page.locator('#new-group-name').fill('  Tech ');
    await page.locator('#create-group').click();

    // Straight to the new group, with the channel picker open
    await expect(page).toHaveURL(/#groupe\/Tech$/);
    await expect(page.locator('#add-panel')).toBeVisible();
    await expect(page.locator('#add-selected')).toBeDisabled();
    await page.locator('#channel-search').fill('chaine b');
    await expect(page.locator('#channel-list .channel-checkbox:visible')).toHaveText(['Chaîne B']);
    await page.locator('#channel-search').fill('');
    await checkChannel(page, 'Chaîne B');
    await checkChannel(page, 'Chaîne C');
    await expect(page.locator('#selected-count')).toHaveText('2 sélectionnées');
    await page.locator('#add-selected').click();

    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne B', 'Chaîne C']);
    await expect(page.locator('#add-panel')).toBeHidden();
    expect(await readStorage(page, 'yt_user_groups')).toEqual({ Tech: ['UC_B', 'UC_C'] });
    await expect(chips(page)).toHaveText(['Tous', 'Tech']);

    // A second group with the same name is refused
    await page.locator('.back-link').click();
    await page.locator('#new-group').click();
    await page.locator('#new-group-name').fill('Tech');
    await page.locator('#create-group').click();
    await expect(page.locator('#error-message')).toHaveText('Un groupe nommé « Tech » existe déjà');
    await expect(page).toHaveURL(/#groupes$/);
    await page.locator('#cancel-new-group').click();

    // Rename, then delete
    await cards(page).first().click();
    await page.locator('#rename-group').click();
    await page.locator('#rename-input').fill('Techno');
    await page.locator('#rename-form button[type="submit"]').click();
    await expect(page).toHaveURL(/#groupe\/Techno$/);
    await expect(page.locator('#group-title')).toHaveText('Techno');
    expect(Object.keys(await readStorage(page, 'yt_user_groups'))).toEqual(['Techno']);

    await page.locator('#delete-group').click();
    await expect(page).toHaveURL(/#groupes$/);
    await expect(page.locator('#groups-grid')).toContainText('Aucun groupe');
    expect(await readStorage(page, 'yt_user_groups')).toEqual({});
});

test('a channel can be in several groups, added from the "Sans groupe" page or a row menu', async ({ page }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A'], Musique: ['UC_C'] } }, '/#groupes');
    await expect(page.locator('#ungrouped-count')).toHaveText('1');

    await page.locator('#ungrouped-link').click();
    await expect(page).toHaveURL(/#sans-groupe$/);
    await expect(page.locator('#group-title')).toHaveText('Sans groupe');
    await expect(page.locator('#group-actions')).toBeHidden();
    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne B']);

    const menu = await openRowMenu(page, 'Chaîne B');
    await expect(menu.locator('.menu-item')).toHaveText(['Voir ses vidéos dans le fil', 'Tech', 'Musique']);
    await menu.locator('.menu-item', { hasText: 'Tech' }).click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#group-channels')).toContainText('Toutes vos chaînes sont dans au moins un groupe');

    // In Tech, add Chaîne B to Musique too: it shows Musique as its other group
    await page.goto('/#groupe/Tech');
    const menuB = await openRowMenu(page, 'Chaîne B');
    await expect(menuB.locator('.menu-item')).toHaveText(['Voir ses vidéos dans le fil', 'Musique', 'Retirer de « Tech »']);
    await menuB.locator('.menu-item', { hasText: 'Musique' }).click();
    await expect(rowOf(page, 'Chaîne B').locator('.mini-chip')).toHaveText(['Musique']);
    expect(await readStorage(page, 'yt_user_groups')).toEqual({ Tech: ['UC_A', 'UC_B'], Musique: ['UC_C', 'UC_B'] });

    // Remove it from Tech: it stays in Musique
    const menuAgain = await openRowMenu(page, 'Chaîne B');
    await menuAgain.locator('.menu-item', { hasText: 'Retirer de' }).click();
    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne A']);
    expect(await readStorage(page, 'yt_user_groups')).toEqual({ Tech: ['UC_A'], Musique: ['UC_C', 'UC_B'] });
});

test('"Voir le fil" shows the feed filtered on the group', async ({ page }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_B'] } }, '/#groupe/Tech');
    await page.locator('#show-group-feed').click();

    await expect(page).toHaveURL(/\/#?$/);
    await expect(page.locator('#feed-view')).toBeVisible();
    await expect(page.locator('.filter-button.active')).toHaveText('Tech');
    await expect(feedCards(page)).toHaveCount(5);
});

test('the search box filters the groups, then the channels of a group', async ({ page }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A', 'UC_B'], Musique: ['UC_C'] } }, '/#groupes');
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Rechercher dans les groupes');

    await page.locator('#search-input').fill('musi');
    await expect(cards(page)).toHaveText([/Musique/]);
    await page.locator('#search-input').fill('chaine a'); // By a channel of the group
    await expect(cards(page)).toHaveText([/Tech/]);
    await page.locator('#search-input').fill('zzz');
    await expect(page.locator('#groups-grid')).toContainText('Aucun groupe ne correspond');

    await page.goto('/#groupe/Tech');
    await page.locator('#search-input').fill('B');
    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne B']);
});

test('exports the groups to a file that imports them back on another device', async ({ page, browser }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A', 'UC_B'], Musique: ['UC_C'] } }, '/#groupes');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-groups').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^groupes-global-video-feed-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf8')));
    expect(file.groups).toEqual([
        { name: 'Tech', channels: [{ id: 'UC_A', name: 'Chaîne A' }, { id: 'UC_B', name: 'Chaîne B' }] },
        { name: 'Musique', channels: [{ id: 'UC_C', name: 'Chaîne C' }] }
    ]);

    // Another device: an empty browser, with one group already named like an imported one
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await new FakeYouTube().install(other);
    const otherPage = await other.newPage();
    await openApp(otherPage, { ...signedIn(), yt_user_groups: { Musique: ['UC_X'] } }, '/#groupes');
    const upload = content => otherPage.locator('#import-groups-file').setInputFiles({
        name: 'groupes.json', mimeType: 'application/json', buffer: Buffer.from(content)
    });

    await upload(JSON.stringify(file));
    await expect(otherPage.locator('#error-message')).toHaveText('Import terminé : 1 groupe ajouté, 1 groupe complété.');
    expect(await readStorage(otherPage, 'yt_user_groups')).toEqual({ Musique: ['UC_X', 'UC_C'], Tech: ['UC_A', 'UC_B'] });
    await expect(cards(otherPage)).toHaveCount(2);
    await expect(chips(otherPage)).toHaveText(['Tous', 'Musique', 'Tech']);

    await upload(JSON.stringify(file));
    await expect(otherPage.locator('#error-message')).toHaveText('Aucun nouveau groupe ni nouvelle chaîne à importer.');

    await upload('{"foo": 1}');
    await expect(otherPage.locator('#error-message')).toContainText('pas un export de groupes');
    await other.close();
});

test('inactive channels are flagged, listed, and moved to Archive in one click', async ({ page, youtube }) => {
    youtube.inactive.add('UC_C');
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A', 'UC_B'], Musique: ['UC_C'] } }, '/#groupes');
    await expect(page.locator('#inactive-count')).toHaveText('1');

    await page.goto('/#groupe/Musique');
    await expect(page.locator('#group-meta')).toContainText('1 inactive');
    await expect(rowOf(page, 'Chaîne C').locator('.inactive-badge')).toHaveText('Inactive');
    await expect(rowOf(page, 'Chaîne C').locator('.group-meta')).toContainText('il y a 1 an');

    await page.locator('.back-link').click();
    await page.locator('#inactive-link').click();
    await expect(page).toHaveURL(/#inactives$/);
    await expect(page.locator('#group-title')).toHaveText('Inactives depuis plus d\'un an');
    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne C']);
    await expect(rows(page).first().locator('.mini-chip')).toHaveText(['Musique']);

    await page.locator('#archive-all').click();
    await expect(page).toHaveURL(/#groupe\/Archive$/);
    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne C']);
    expect(await readStorage(page, 'yt_user_groups')).toEqual({ Tech: ['UC_A', 'UC_B'], Musique: [], Archive: ['UC_C'] });
    await expect(chips(page)).toHaveText(['Tous', 'Tech', 'Musique', 'Archive']);

    // Still inactive, but already archived: nothing left to move
    await page.goto('/#inactives');
    await expect(rows(page).locator('.channel-row-name')).toHaveText(['Chaîne C']);
    await expect(rows(page).first().locator('.mini-chip')).toHaveText(['Archive']);
    await expect(page.locator('#group-meta')).toContainText('1 déjà dans « Archive »');
    await expect(page.locator('#archive-all')).toBeHidden();
});

test('groups can be reordered and hidden from the feed filters', async ({ page }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A'], Musique: ['UC_B'], Archive: ['UC_C'] } }, '/#groupes');
    await expect(cards(page).locator('.group-card-title')).toHaveText(['Tech', 'Musique', 'Archive']);

    // Archive goes up once, Tech cannot go up
    const cardMenu = name => page.locator('.group-card-wrap', { has: page.locator('.group-card-title', { hasText: name }) }).locator('.card-menu');
    await cardMenu('Tech').locator('summary').click();
    await expect(cardMenu('Tech').locator('.menu-item', { hasText: 'Monter' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await cardMenu('Archive').locator('summary').click();
    await cardMenu('Archive').locator('.menu-item', { hasText: 'Monter' }).click();
    await expect(cards(page).locator('.group-card-title')).toHaveText(['Tech', 'Archive', 'Musique']);
    expect(Object.keys(await readStorage(page, 'yt_user_groups'))).toEqual(['Tech', 'Archive', 'Musique']);
    await expect(chips(page)).toHaveText(['Tous', 'Tech', 'Archive', 'Musique']);

    // Hide Archive: no chip, but the group and its page stay
    await cardMenu('Archive').locator('summary').click();
    await cardMenu('Archive').locator('.menu-item', { hasText: 'Masquer dans le fil' }).click();
    await expect(chips(page)).toHaveText(['Tous', 'Tech', 'Musique']);
    await expect(cardMenu('Archive').locator('..')).toContainText('masqué du fil');
    expect(await readStorage(page, 'yt_hidden_groups')).toEqual(['Archive']);
    await page.goto('/#groupe/Archive');
    await expect(rows(page)).toHaveCount(1);

    // Renaming keeps it hidden; showing it again brings the chip back
    await page.locator('#rename-group').click();
    await page.locator('#rename-input').fill('Vieux');
    await page.locator('#rename-form button[type="submit"]').click();
    await expect(chips(page)).toHaveText(['Tous', 'Tech', 'Musique']);
    expect(await readStorage(page, 'yt_hidden_groups')).toEqual(['Vieux']);
    await page.goto('/#groupes');
    await cardMenu('Vieux').locator('summary').click();
    await cardMenu('Vieux').locator('.menu-item', { hasText: 'Afficher dans le fil' }).click();
    await expect(chips(page)).toHaveText(['Tous', 'Tech', 'Vieux', 'Musique']);
});

test('the feed can be filtered on one channel from the groups page', async ({ page }) => {
    await openApp(page, { ...signedIn(), yt_user_groups: { Tech: ['UC_A', 'UC_B'] } }, '/#groupe/Tech');
    const menu = await openRowMenu(page, 'Chaîne B');
    await menu.locator('.menu-item', { hasText: 'Voir ses vidéos dans le fil' }).click();

    await expect(page.locator('#feed-view')).toBeVisible();
    await expect(feedCards(page)).toHaveCount(5);
    await expect(feedCards(page).locator('.channel-name')).toHaveText(Array(5).fill('Chaîne B'));
    await expect(page.locator('.channel-chip')).toHaveText('Chaîne B');
    await expect(page.locator('.filter-button.active')).toHaveCount(1);

    // The × on the chip, or any group chip, drops the channel filter
    await page.locator('.channel-chip').click();
    await expect(page.locator('.channel-chip')).toHaveCount(0);
    await expect(feedCards(page)).toHaveCount(15);
    await expect(page.locator('.filter-button.active')).toHaveText('Tous');
});

test('an unknown group in the URL goes back to the overview', async ({ page }) => {
    await openApp(page, signedIn(), '/#groupe/Inconnu');
    await expect(page.locator('#error-message')).toContainText('n\'existe pas');
    await expect(page).toHaveURL(/#groupes$/);
});
