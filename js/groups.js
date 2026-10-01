// Groups management modal

import { getChannelNames, getPlaylistCache, getUserGroups, saveUserGroups } from './storage.js';
import { showError } from './ui.js';

// Wire the modal buttons; onGroupsChanged is called after a group is saved
export function setupGroupsModal(onGroupsChanged) {
    const closeModalButton = document.getElementById('close-modal');
    if (closeModalButton) {
        closeModalButton.addEventListener('click', closeGroupsModal);
    }

    const saveGroupButton = document.getElementById('save-group');
    if (saveGroupButton) {
        saveGroupButton.addEventListener('click', () => {
            if (saveNewGroup()) {
                onGroupsChanged();
            }
        });
    }
}

// Open groups modal
export function openGroupsModal() {
    const modal = document.getElementById('groups-modal');
    if (modal) {
        modal.style.display = 'flex';
        populateChannelList();
    }
}

// Close groups modal
function closeGroupsModal() {
    const modal = document.getElementById('groups-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Populate channel list in modal
function populateChannelList() {
    const channelListEl = document.getElementById('channel-list');
    if (!channelListEl) return;

    channelListEl.innerHTML = '';

    const channelNames = getChannelNames();
    const channelIds = Object.keys(getPlaylistCache());

    if (channelIds.length === 0) {
        channelListEl.innerHTML = '<p class="no-channels">Aucune chaîne disponible</p>';
        return;
    }

    // Sort by channel name
    channelIds.sort((a, b) => {
        const nameA = channelNames[a] || a;
        const nameB = channelNames[b] || b;
        return nameA.localeCompare(nameB);
    });

    channelIds.forEach(channelId => {
        const label = document.createElement('label');
        label.className = 'channel-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = channelId;
        checkbox.dataset.channelId = channelId;

        const span = document.createElement('span');
        span.textContent = channelNames[channelId] || channelId;

        label.appendChild(checkbox);
        label.appendChild(span);
        channelListEl.appendChild(label);
    });
}

// Save new group; returns true if it was saved
function saveNewGroup() {
    const groupNameInput = document.getElementById('group-name');
    const channelCheckboxes = document.querySelectorAll('#channel-list input[type="checkbox"]:checked');

    if (!groupNameInput) return false;

    const groupName = groupNameInput.value.trim();

    if (!groupName) {
        showError('Veuillez entrer un nom de groupe');
        return false;
    }

    const selectedChannels = Array.from(channelCheckboxes).map(cb => cb.value);

    if (selectedChannels.length === 0) {
        showError('Veuillez sélectionner au moins une chaîne');
        return false;
    }

    // Save group
    const groups = getUserGroups();
    groups[groupName] = selectedChannels;
    saveUserGroups(groups);

    // Reset form
    groupNameInput.value = '';
    channelCheckboxes.forEach(cb => cb.checked = false);

    closeGroupsModal();

    console.log(`Group "${groupName}" created with ${selectedChannels.length} channels`);
    return true;
}
