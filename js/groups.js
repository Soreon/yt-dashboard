// Groups management modal: list of groups, and an editor to create, edit or delete one

import { normalizeText } from './feed.js';
import { removeGroup, upsertGroup } from './groups-model.js';
import { getChannelAvatars, getChannelNames, getPlaylistCache, getUserGroups, saveUserGroups } from './storage.js';
import { setAvatar, showError } from './ui.js';

const ICON_EDIT = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
const ICON_DELETE = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';

let editedGroup = null; // Name of the group being edited (null = creating one)
let notifyChange = () => {};

const $ = id => document.getElementById(id);

// Wire the modal; onGroupsChanged({ from, to }) is called after a group is created
// (from: null), renamed or edited (from → to) or deleted (to: null)
export function setupGroupsModal(onGroupsChanged) {
    notifyChange = onGroupsChanged;

    $('close-modal')?.addEventListener('click', closeGroupsModal);
    $('new-group')?.addEventListener('click', () => showEditor(null));
    $('cancel-group')?.addEventListener('click', showList);
    $('save-group')?.addEventListener('click', saveGroup);
    $('delete-group')?.addEventListener('click', () => deleteGroup(editedGroup));
    $('channel-search')?.addEventListener('input', filterChannelList);
    $('channel-list')?.addEventListener('change', updateSelectedCount);
    $('group-name')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') saveGroup();
    });

    // Close with a click on the backdrop, or Escape
    $('groups-modal')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) closeGroupsModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen()) closeGroupsModal();
    });
}

function isOpen() {
    return $('groups-modal')?.style.display === 'flex';
}

// Open groups modal: the list of groups, or straight to the editor if there is none yet
export function openGroupsModal() {
    const modal = $('groups-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    if (Object.keys(getUserGroups()).length === 0) {
        showEditor(null);
    } else {
        showList();
    }
}

function closeGroupsModal() {
    const modal = $('groups-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function setView(view) {
    $('groups-list-view').hidden = view !== 'list';
    $('list-actions').hidden = view !== 'list';
    $('group-editor').hidden = view !== 'editor';
    $('editor-actions').hidden = view !== 'editor';
}

function iconButton(path, label, onClick) {
    const button = document.createElement('button');
    button.className = 'icon-button';
    button.setAttribute('aria-label', label);
    button.title = label.split(' ')[0];
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    button.addEventListener('click', onClick);
    return button;
}

// List of groups, each with its number of channels, edit and delete buttons
function showList() {
    setView('list');
    $('groups-modal-title').textContent = 'Gérer les groupes';

    const list = $('groups-list');
    list.innerHTML = '';

    const entries = Object.entries(getUserGroups());
    if (entries.length === 0) {
        list.innerHTML = '<li class="no-channels">Aucun groupe pour l\'instant. Créez-en un pour filtrer le fil par thème.</li>';
        return;
    }

    entries.forEach(([name, channelIds]) => {
        const item = document.createElement('li');
        item.className = 'group-item';

        const open = document.createElement('button');
        open.className = 'group-open';
        const nameEl = document.createElement('span');
        nameEl.className = 'group-name';
        nameEl.textContent = name;
        const countEl = document.createElement('span');
        countEl.className = 'group-count';
        countEl.textContent = `${channelIds.length} chaîne${channelIds.length > 1 ? 's' : ''}`;
        open.append(nameEl, countEl);
        open.addEventListener('click', () => showEditor(name));

        item.append(
            open,
            iconButton(ICON_EDIT, `Modifier ${name}`, () => showEditor(name)),
            iconButton(ICON_DELETE, `Supprimer ${name}`, () => deleteGroup(name))
        );
        list.appendChild(item);
    });
}

// Editor of a group (groupName null = new group)
function showEditor(groupName) {
    editedGroup = groupName;
    setView('editor');

    const creating = groupName === null;
    $('groups-modal-title').textContent = creating ? 'Nouveau groupe' : 'Modifier le groupe';
    $('save-group').textContent = creating ? 'Créer le groupe' : 'Enregistrer';
    $('delete-group').hidden = creating;
    $('group-name').value = groupName || '';
    $('channel-search').value = '';

    populateChannelList(new Set(creating ? [] : getUserGroups()[groupName] || []));
    $('group-name').focus();
}

// Subscribed channels, sorted by name, with the group's ones checked
function populateChannelList(selected) {
    const channelListEl = $('channel-list');
    channelListEl.innerHTML = '';

    const channelNames = getChannelNames();
    const channelAvatars = getChannelAvatars();
    const channelIds = Object.keys(getPlaylistCache());

    if (channelIds.length === 0) {
        channelListEl.innerHTML = '<p class="no-channels">Aucune chaîne disponible</p>';
        updateSelectedCount();
        return;
    }

    channelIds.sort((a, b) => (channelNames[a] || a).localeCompare(channelNames[b] || b));

    channelIds.forEach(channelId => {
        const name = channelNames[channelId] || channelId;

        const label = document.createElement('label');
        label.className = 'channel-checkbox';
        label.dataset.search = normalizeText(name);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = channelId;
        checkbox.checked = selected.has(channelId);

        const avatar = document.createElement('span');
        avatar.className = 'avatar avatar-small';
        setAvatar(avatar, channelAvatars[channelId], name);

        const span = document.createElement('span');
        span.className = 'channel-checkbox-name';
        span.textContent = name;

        label.append(checkbox, avatar, span);
        channelListEl.appendChild(label);
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
    const count = document.querySelectorAll('#channel-list input[type="checkbox"]:checked').length;
    $('selected-count').textContent =
        count === 0 ? 'aucune sélectionnée' : `${count} sélectionnée${count > 1 ? 's' : ''}`;
}

function saveGroup() {
    const channelIds = Array.from(
        document.querySelectorAll('#channel-list input[type="checkbox"]:checked'),
        checkbox => checkbox.value
    );
    const name = $('group-name').value.trim();
    const result = upsertGroup(getUserGroups(), { originalName: editedGroup, name, channelIds });

    if (result.error) {
        showError(result.error);
        return;
    }

    saveUserGroups(result.groups);
    notifyChange({ from: editedGroup, to: name });
    showList();
}

function deleteGroup(name) {
    if (name === null || !confirm(`Supprimer le groupe « ${name} » ?`)) return;

    saveUserGroups(removeGroup(getUserGroups(), name));
    notifyChange({ from: name, to: null });
    showList();
}
