// Groups page: overview of the groups (cards), one group (its channels), or the channels without group

import { getRelativeTime, isValidYouTubeId, normalizeText } from './feed.js';
import {
    addToGroup, channelActivity, exportGroups, groupActivity, groupsOfChannel, inactiveChannels, isInactive,
    mergeGroups, moveGroup, moveToGroup, parseGroupsFile, removeFromGroup, removeGroup, renameGroup,
    ungroupedChannels, upsertGroup
} from './groups-model.js';
import {
    getChannelAvatars, getChannelNames, getHiddenGroups, getUserGroups, getVideoCache, getWatchHistory,
    saveHiddenGroups, saveUserGroups
} from './storage.js';
import { downloadJson, setAvatar, showError, showToast } from './ui.js';

const ICON_MORE = 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z';
const UNGROUPED = Symbol('ungrouped');
const INACTIVE = Symbol('inactive');
const ARCHIVE_GROUP = 'Archive';

let handlers = { onGroupsChanged: () => {}, onShowFeed: () => {}, onShowChannelFeed: () => {} };
let route = { view: 'overview' }; // { view: 'overview' | 'ungrouped' | 'inactive' } | { view: 'detail', name }
let searchQuery = '';
let renderedKey = null; // Which view was rendered last: a re-render of the same one keeps its forms open
let openAddPanelNext = false; // Open the channel picker at the next render (after creating a group)

const $ = id => document.getElementById(id);
const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;

// Route of a groups page hash, or null for any other hash
export function groupsRouteFromHash(hash) {
    if (hash === '#groupes') return { view: 'overview' };
    if (hash === '#sans-groupe') return { view: 'ungrouped' };
    if (hash === '#inactives') return { view: 'inactive' };
    if (hash.startsWith('#groupe/')) {
        try {
            return { view: 'detail', name: decodeURIComponent(hash.slice('#groupe/'.length)) };
        } catch {
            return { view: 'overview' };
        }
    }
    return null;
}

export function groupHash(name) {
    return `#groupe/${encodeURIComponent(name)}`;
}

// Wire the page; onGroupsChanged({ from, to }) is called after a group is created (from: null),
// renamed (from → to), changed (from = to) or deleted (to: null); onShowFeed(name) shows the feed of a group,
// onShowChannelFeed(channelId, name) the feed of one channel
export function setupGroupsPage(pageHandlers) {
    handlers = pageHandlers;

    // Overview: create, import, export
    $('new-group').addEventListener('click', () => {
        $('new-group-form').hidden = false;
        $('new-group-name').focus();
    });
    $('cancel-new-group').addEventListener('click', hideNewGroupForm);
    $('new-group-form').addEventListener('submit', event => {
        event.preventDefault();
        createGroup($('new-group-name').value);
    });
    $('export-groups').addEventListener('click', exportGroupsFile);
    const importInput = $('import-groups-file');
    $('import-groups').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
        if (importInput.files[0]) importGroupsFile(importInput.files[0]);
        importInput.value = '';
    });

    // Detail: feed, add channels, rename, delete
    $('show-group-feed').addEventListener('click', () => handlers.onShowFeed(route.name));
    $('add-channels').addEventListener('click', () => showAddPanel(true));
    $('cancel-add').addEventListener('click', () => showAddPanel(false));
    $('add-selected').addEventListener('click', addSelectedChannels);
    $('channel-search').addEventListener('input', filterChannelList);
    $('channel-list').addEventListener('change', updateSelectedCount);
    $('rename-group').addEventListener('click', () => showRenameForm(true));
    $('cancel-rename').addEventListener('click', () => showRenameForm(false));
    $('rename-form').addEventListener('submit', event => {
        event.preventDefault();
        renameCurrentGroup($('rename-input').value);
    });
    $('delete-group').addEventListener('click', () => deleteGroup(route.name));
    $('archive-all').addEventListener('click', archiveInactiveChannels);

    // Row menus (<details>) close on a click elsewhere or Escape
    document.addEventListener('click', event => {
        document.querySelectorAll('details.row-menu[open]').forEach(menu => {
            if (!menu.contains(event.target)) menu.open = false;
        });
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            document.querySelectorAll('details.row-menu[open]').forEach(menu => { menu.open = false; });
        }
    });
}

// Render the page for a route, filtered by the search box
export function renderGroupsPage(pageRoute, query = '') {
    route = pageRoute;
    searchQuery = normalizeText(query.trim());

    const detail = route.view !== 'overview';
    $('groups-overview').hidden = detail;
    $('group-detail').hidden = !detail;

    if (route.view === 'overview') {
        renderOverview();
    } else if (route.view === 'ungrouped') {
        renderChannelsView(UNGROUPED);
    } else if (route.view === 'inactive') {
        renderChannelsView(INACTIVE);
    } else if (Object.hasOwn(getUserGroups(), route.name)) {
        renderChannelsView(route.name);
    } else {
        showError(`Le groupe « ${route.name} » n'existe pas.`);
        location.hash = '#groupes';
    }
}

function subscribedChannelIds() {
    return Object.keys(getChannelNames());
}

function sortByName(channelIds, channelNames) {
    return [...channelIds].sort((a, b) => (channelNames[a] || a).localeCompare(channelNames[b] || b));
}

function matches(name) {
    return !searchQuery || normalizeText(name).includes(searchQuery);
}

// --- Overview ---

function renderOverview() {
    renderedKey = 'overview';
    const groups = getUserGroups();
    const channelNames = getChannelNames();
    const channelAvatars = getChannelAvatars();
    const videoCache = getVideoCache();
    const history = getWatchHistory();
    const entries = Object.entries(groups);

    $('export-groups').disabled = entries.length === 0;
    $('ungrouped-count').textContent = ungroupedChannels(groups, subscribedChannelIds()).length;
    $('inactive-count').textContent = inactiveChannels(subscribedChannelIds(), videoCache).length;

    const grid = $('groups-grid');
    grid.innerHTML = '';

    if (entries.length === 0) {
        grid.innerHTML = '<div class="no-videos">Aucun groupe pour l\'instant. Créez-en un pour filtrer le fil par thème, ou importez un fichier de groupes.</div>';
        return;
    }

    // A group matches the search by its name or by one of its channels
    const shown = entries.filter(([name, ids]) => matches(name) || ids.some(id => matches(channelNames[id] || '')));
    if (shown.length === 0) {
        grid.innerHTML = `<div class="no-videos">Aucun groupe ne correspond à « ${escapeText(searchQuery)} ».</div>`;
        return;
    }

    const hiddenGroups = getHiddenGroups();
    const names = entries.map(([name]) => name);

    shown.forEach(([name, channelIds]) => {
        const { lastUpload, unwatched } = groupActivity(channelIds, videoCache, history);
        const hidden = hiddenGroups.includes(name);

        const wrap = document.createElement('div');
        wrap.className = 'group-card-wrap';

        const card = document.createElement('a');
        card.className = 'group-card';
        card.href = groupHash(name);

        const mosaic = document.createElement('div');
        mosaic.className = 'group-mosaic';
        channelIds.slice(0, 4).forEach(channelId => {
            const avatar = document.createElement('span');
            avatar.className = 'avatar';
            setAvatar(avatar, channelAvatars[channelId], channelNames[channelId]);
            mosaic.appendChild(avatar);
        });
        if (channelIds.length === 0) {
            mosaic.classList.add('empty');
            mosaic.textContent = 'Vide';
        }

        const title = document.createElement('h3');
        title.className = 'group-card-title';
        title.textContent = name;

        const meta = document.createElement('p');
        meta.className = 'group-meta';
        meta.textContent = plural(channelIds.length, 'chaîne') + (hidden ? ' · masqué du fil' : '');

        const activity = document.createElement('p');
        activity.className = 'group-meta';
        activity.textContent = [
            unwatched > 0 ? `${plural(unwatched, 'vidéo')} non ${unwatched > 1 ? 'vues' : 'vue'}` : 'Tout est vu',
            lastUpload ? getRelativeTime(lastUpload) : null
        ].filter(Boolean).join(' · ');

        card.append(mosaic, title, meta, activity);
        wrap.append(card, createCardMenu(name, names.indexOf(name), names.length, hidden));
        grid.appendChild(wrap);
    });
}

// Card menu: move the group among the filters, hide it from the feed
function createCardMenu(name, index, count, hidden) {
    const details = document.createElement('details');
    details.className = 'row-menu card-menu';

    const summary = document.createElement('summary');
    summary.className = 'icon-button';
    summary.setAttribute('aria-label', `Options de ${name}`);
    summary.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_MORE}"/></svg>`;

    const menu = document.createElement('div');
    menu.className = 'menu row-menu-items';

    const up = menuItem('Monter', () => reorderGroup(name, -1));
    up.disabled = index === 0;
    const down = menuItem('Descendre', () => reorderGroup(name, 1));
    down.disabled = index === count - 1;
    menu.append(up, down, menuItem(hidden ? 'Afficher dans le fil' : 'Masquer dans le fil', () => toggleHidden(name)));

    details.append(summary, menu);
    return details;
}

function reorderGroup(name, offset) {
    saveUserGroups(moveGroup(getUserGroups(), name, offset));
    handlers.onGroupsChanged({ from: name, to: name });
    renderGroupsPage(route, searchQuery);
}

// A hidden group keeps its channels and its page, but has no chip among the feed filters
function toggleHidden(name) {
    const hidden = getHiddenGroups();
    saveHiddenGroups(hidden.includes(name) ? hidden.filter(groupName => groupName !== name) : [...hidden, name]);
    handlers.onGroupsChanged({ from: name, to: name });
    renderGroupsPage(route, searchQuery);
}

function escapeText(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span.innerHTML;
}

// --- One group, or the channels without group ---

function renderChannelsView(target) {
    const groups = getUserGroups();
    const channelNames = getChannelNames();
    const channelAvatars = getChannelAvatars();
    const videoCache = getVideoCache();
    const history = getWatchHistory();
    const ungrouped = target === UNGROUPED;
    const inactive = target === INACTIVE;

    let channelIds;
    if (inactive) {
        channelIds = inactiveChannels(subscribedChannelIds(), videoCache); // Most recently active first
    } else {
        channelIds = sortByName(ungrouped ? ungroupedChannels(groups, subscribedChannelIds()) : groups[target], channelNames);
    }

    $('group-title').textContent = ungrouped ? 'Sans groupe' : inactive ? 'Inactives depuis plus d\'un an' : target;
    $('group-actions').hidden = ungrouped || inactive;
    const notArchived = inactive ? inactiveChannelsToArchive(groups) : [];
    $('inactive-actions').hidden = !inactive || notArchived.length === 0;

    // Arriving on this view: closed forms (or the picker open, right after creating the group)
    const key = ungrouped ? 'ungrouped' : inactive ? 'inactive' : `group:${target}`;
    if (key !== renderedKey) {
        renderedKey = key;
        showRenameForm(false);
        showAddPanel(openAddPanelNext);
        openAddPanelNext = false;
    }

    const { lastUpload, unwatched } = groupActivity(channelIds, videoCache, history);
    const inactiveCount = inactiveChannels(channelIds, videoCache).length;
    $('group-meta').textContent = ungrouped
        ? `${plural(channelIds.length, 'chaîne')} dans aucun groupe`
        : inactive
        ? `${plural(channelIds.length, 'chaîne')} sans vidéo depuis un an, d'après les vidéos connues de l'application`
            + (channelIds.length > notArchived.length ? ` · ${channelIds.length - notArchived.length} déjà dans « ${ARCHIVE_GROUP} »` : '')
        : [
            plural(channelIds.length, 'chaîne'),
            `${plural(unwatched, 'vidéo')} non ${unwatched > 1 ? 'vues' : 'vue'}`,
            lastUpload ? `dernière vidéo ${getRelativeTime(lastUpload)}` : null,
            inactiveCount > 0 ? `${inactiveCount} inactive${inactiveCount > 1 ? 's' : ''}` : null
        ].filter(Boolean).join(' · ');

    const rows = $('group-channels');
    rows.innerHTML = '';

    if (channelIds.length === 0) {
        rows.innerHTML = `<div class="no-videos">${ungrouped
            ? 'Toutes vos chaînes sont dans au moins un groupe.'
            : inactive
            ? 'Aucune chaîne inactive : toutes ont publié une vidéo depuis un an.'
            : 'Ce groupe est vide. Ajoutez-lui des chaînes pour le voir dans le fil.'}</div>`;
        return;
    }

    const shown = channelIds.filter(id => matches(channelNames[id] || id));
    if (shown.length === 0) {
        rows.innerHTML = `<div class="no-videos">Aucune chaîne ne correspond à « ${escapeText(searchQuery)} ».</div>`;
        return;
    }

    shown.forEach(channelId => {
        rows.appendChild(createChannelRow(channelId, target, {
            groups, channelNames, channelAvatars,
            activity: channelActivity(channelId, videoCache, history)
        }));
    });
}

// One channel: avatar, name, activity, its other groups, and a menu to add it to / remove it from groups
function createChannelRow(channelId, target, { groups, channelNames, channelAvatars, activity }) {
    const name = channelNames[channelId] || channelId;
    const row = document.createElement('div');
    row.className = 'channel-row';

    const avatar = document.createElement('span');
    avatar.className = 'avatar avatar-row';
    setAvatar(avatar, channelAvatars[channelId], name);

    const main = document.createElement('div');
    main.className = 'channel-row-main';

    const title = document.createElement(isValidYouTubeId(channelId) ? 'a' : 'span');
    title.className = 'channel-row-name';
    title.textContent = name;
    if (title.tagName === 'A') {
        title.href = `https://www.youtube.com/channel/${channelId}`;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
    }

    const meta = document.createElement('p');
    meta.className = 'group-meta';
    meta.textContent = [
        activity.lastUpload ? `dernière vidéo ${getRelativeTime(activity.lastUpload)}` : 'aucune vidéo connue',
        activity.unwatched > 0 ? `${plural(activity.unwatched, 'vidéo')} non ${activity.unwatched > 1 ? 'vues' : 'vue'}` : null
    ].filter(Boolean).join(' · ');

    main.append(title, meta);

    if (isInactive(activity.lastUpload)) {
        const badge = document.createElement('span');
        badge.className = 'inactive-badge';
        badge.textContent = 'Inactive';
        title.after(badge);
        title.style.display = 'inline';
    }

    const otherGroups = groupsOfChannel(groups, channelId).filter(groupName => groupName !== target);
    if (otherGroups.length > 0) {
        const chips = document.createElement('div');
        chips.className = 'channel-row-groups';
        otherGroups.forEach(groupName => {
            const chip = document.createElement('a');
            chip.className = 'mini-chip';
            chip.href = groupHash(groupName);
            chip.textContent = groupName;
            chips.appendChild(chip);
        });
        main.appendChild(chips);
    }

    row.append(avatar, main, createRowMenu(channelId, name, target, groups));
    return row;
}

function createRowMenu(channelId, channelName, target, groups) {
    const details = document.createElement('details');
    details.className = 'row-menu';

    const summary = document.createElement('summary');
    summary.className = 'icon-button';
    summary.setAttribute('aria-label', `Actions pour ${channelName}`);
    summary.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_MORE}"/></svg>`;

    const menu = document.createElement('div');
    menu.className = 'menu row-menu-items';

    menu.appendChild(menuItem('Voir ses vidéos dans le fil', () => handlers.onShowChannelFeed(channelId, channelName)));

    const addable = Object.keys(groups).filter(groupName => !groups[groupName].includes(channelId));
    if (addable.length > 0) {
        const label = document.createElement('p');
        label.className = 'menu-label';
        label.textContent = 'Ajouter à';
        menu.appendChild(label);
        addable.forEach(groupName => {
            menu.appendChild(menuItem(groupName, () => {
                saveUserGroups(addToGroup(getUserGroups(), groupName, [channelId]));
                handlers.onGroupsChanged({ from: groupName, to: groupName });
                showToast(`${channelName} ajoutée à « ${groupName} »`);
                renderGroupsPage(route, searchQuery);
            }));
        });
    }

    if (typeof target === 'string') {
        const remove = menuItem(`Retirer de « ${target} »`, () => {
            saveUserGroups(removeFromGroup(getUserGroups(), target, channelId));
            handlers.onGroupsChanged({ from: target, to: target });
            renderGroupsPage(route, searchQuery);
        });
        remove.classList.add('danger-item');
        menu.appendChild(remove);
    }

    details.append(summary, menu);
    return details;
}

function menuItem(label, onClick) {
    const button = document.createElement('button');
    button.className = 'menu-item';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

// --- Create, rename, delete ---

function hideNewGroupForm() {
    $('new-group-form').hidden = true;
    $('new-group-name').value = '';
}

function createGroup(name) {
    const result = upsertGroup(getUserGroups(), { name, channelIds: [] });
    if (result.error) {
        showError(result.error);
        return;
    }

    saveUserGroups(result.groups);
    hideNewGroupForm();
    handlers.onGroupsChanged({ from: null, to: name.trim() });

    // Straight to the new group, with the channel picker open
    openAddPanelNext = true;
    location.hash = groupHash(name.trim());
}

function showRenameForm(visible) {
    $('rename-form').hidden = !visible;
    $('group-title').hidden = visible;
    if (visible) {
        $('rename-input').value = route.name;
        $('rename-input').focus();
        $('rename-input').select();
    }
}

function renameCurrentGroup(newName) {
    const from = route.name;
    const to = newName.trim();
    if (to === from) {
        showRenameForm(false);
        return;
    }

    const result = renameGroup(getUserGroups(), from, to);
    if (result.error) {
        showError(result.error);
        return;
    }

    saveUserGroups(result.groups);
    saveHiddenGroups(getHiddenGroups().map(groupName => (groupName === from ? to : groupName)));
    handlers.onGroupsChanged({ from, to });
    location.hash = groupHash(to);
}

function deleteGroup(name) {
    if (!confirm(`Supprimer le groupe « ${name} » ? Ses chaînes restent dans vos abonnements.`)) return;

    saveUserGroups(removeGroup(getUserGroups(), name));
    saveHiddenGroups(getHiddenGroups().filter(groupName => groupName !== name));
    handlers.onGroupsChanged({ from: name, to: null });
    location.hash = '#groupes';
}

// Inactive channels not in the Archive group yet
function inactiveChannelsToArchive(groups) {
    const archived = new Set(groups[ARCHIVE_GROUP] || []);
    return inactiveChannels(subscribedChannelIds(), getVideoCache()).filter(id => !archived.has(id));
}

// "Tout déplacer vers Archive": the inactive channels join the Archive group and leave the others
function archiveInactiveChannels() {
    const channelIds = inactiveChannelsToArchive(getUserGroups());
    if (channelIds.length === 0) return;
    if (!confirm(`Déplacer ${plural(channelIds.length, 'chaîne inactive')} vers le groupe « ${ARCHIVE_GROUP} » ? Elles seront retirées de leurs autres groupes.`)) return;

    saveUserGroups(moveToGroup(getUserGroups(), ARCHIVE_GROUP, channelIds));
    handlers.onGroupsChanged({ from: null, to: ARCHIVE_GROUP });
    showToast(`${plural(channelIds.length, 'chaîne')} déplacée${channelIds.length > 1 ? 's' : ''} vers « ${ARCHIVE_GROUP} »`);
    location.hash = groupHash(ARCHIVE_GROUP);
}

// --- Add channels panel ---

function showAddPanel(visible) {
    const panel = $('add-panel');
    panel.hidden = !visible;
    if (!visible) return;

    $('channel-search').value = '';
    populateChannelList();
    $('channel-search').focus();
}

// Subscribed channels not in the group yet, sorted by name, with a checkbox each
function populateChannelList() {
    const list = $('channel-list');
    list.innerHTML = '';

    const channelNames = getChannelNames();
    const channelAvatars = getChannelAvatars();
    const inGroup = new Set(getUserGroups()[route.name] || []);
    const candidates = sortByName(subscribedChannelIds().filter(id => !inGroup.has(id)), channelNames);

    if (candidates.length === 0) {
        list.innerHTML = '<p class="no-channels">Toutes vos chaînes sont déjà dans ce groupe.</p>';
    }

    candidates.forEach(channelId => {
        const name = channelNames[channelId] || channelId;

        const label = document.createElement('label');
        label.className = 'channel-checkbox';
        label.dataset.search = normalizeText(name);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = channelId;

        const avatar = document.createElement('span');
        avatar.className = 'avatar avatar-small';
        setAvatar(avatar, channelAvatars[channelId], name);

        const span = document.createElement('span');
        span.className = 'channel-checkbox-name';
        span.textContent = name;

        label.append(checkbox, avatar, span);
        list.appendChild(label);
    });

    updateSelectedCount();
}

function filterChannelList() {
    const query = normalizeText($('channel-search').value.trim());
    document.querySelectorAll('#channel-list .channel-checkbox').forEach(label => {
        label.hidden = !label.dataset.search.includes(query);
    });
}

function updateSelectedCount() {
    const count = document.querySelectorAll('#channel-list input:checked').length;
    $('selected-count').textContent = count === 0 ? 'aucune sélectionnée' : `${count} sélectionnée${count > 1 ? 's' : ''}`;
    $('add-selected').disabled = count === 0;
}

function addSelectedChannels() {
    const channelIds = Array.from(document.querySelectorAll('#channel-list input:checked'), checkbox => checkbox.value);
    if (channelIds.length === 0) return;

    saveUserGroups(addToGroup(getUserGroups(), route.name, channelIds));
    handlers.onGroupsChanged({ from: route.name, to: route.name });
    showToast(`${plural(channelIds.length, 'chaîne')} ajoutée${channelIds.length > 1 ? 's' : ''} à « ${route.name} »`);
    showAddPanel(false);
    renderGroupsPage(route, searchQuery);
}

// --- Export / import ---

function exportGroupsFile() {
    const today = new Date().toISOString().slice(0, 10);
    downloadJson(`groupes-global-video-feed-${today}.json`,
        exportGroups(getUserGroups(), getChannelNames(), Date.now(), getHiddenGroups()));
}

// Groups file chosen: add its groups, and complete the ones with the same name
async function importGroupsFile(file) {
    let incoming;
    try {
        incoming = parseGroupsFile(JSON.parse(await file.text()));
    } catch (error) {
        console.error('Error reading groups file:', error);
        showError('Ce fichier n\'est pas un export de groupes de Global Video Feed.');
        return;
    }

    const before = getUserGroups();
    const { groups, added, completed } = mergeGroups(before, incoming);
    saveUserGroups(groups);

    // Groups hidden in the file stay hidden here, when they are new
    const newlyHidden = incoming.filter(group => group.hidden && !before[group.name]).map(group => group.name);
    if (newlyHidden.length > 0) {
        saveHiddenGroups([...new Set([...getHiddenGroups(), ...newlyHidden])]);
    }
    handlers.onGroupsChanged({ from: null, to: null });
    renderGroupsPage(route, searchQuery);

    if (added === 0 && completed === 0) {
        showToast('Aucun nouveau groupe ni nouvelle chaîne à importer.');
    } else {
        const parts = [];
        if (added > 0) parts.push(`${plural(added, 'groupe')} ${added > 1 ? 'ajoutés' : 'ajouté'}`);
        if (completed > 0) parts.push(`${plural(completed, 'groupe')} ${completed > 1 ? 'complétés' : 'complété'}`);
        showToast(`Import terminé : ${parts.join(', ')}.`);
    }
}
