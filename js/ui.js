// DOM rendering helpers

import { getRelativeTime, isValidYouTubeId } from './feed.js';

// Escape HTML to prevent XSS
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show error message
let errorTimeout = null;
export function showError(message) {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        // Restart the timer so a new message is not hidden by an older one
        clearTimeout(errorTimeout);
        errorTimeout = setTimeout(() => {
            errorEl.style.display = 'none';
        }, 5000);
    }
    console.error(message);
}

// Show/hide loading indicator
export function setLoading(isLoading, message = 'Chargement des abonnements...') {
    const loadingEl = document.getElementById('loading');
    if (!loadingEl) return;

    const loadingText = loadingEl.querySelector('p');
    if (loadingText) {
        loadingText.textContent = message;
    }
    loadingEl.style.display = isLoading ? 'flex' : 'none';
}

// Update authentication UI
export function updateAuthUI(isAuthenticated) {
    const authButton = document.getElementById('authorize-button');
    const signOutButton = document.getElementById('signout-button');
    const forceSyncButton = document.getElementById('force-sync-button');
    const manageGroupsButton = document.getElementById('manage-groups-button');

    if (authButton) {
        // Si connecté, on cache le bouton de connexion, sinon on l'affiche
        authButton.style.display = isAuthenticated ? 'none' : 'inline-block';
    }
    if (signOutButton) {
        // Inversement pour le bouton de déconnexion
        signOutButton.style.display = isAuthenticated ? 'inline-block' : 'none';
    }
    if (forceSyncButton) {
        forceSyncButton.style.display = isAuthenticated ? 'inline-block' : 'none';
    }
    if (manageGroupsButton) {
        manageGroupsButton.style.display = isAuthenticated ? 'inline-block' : 'none';
    }
}

// Clear UI
export function clearUI() {
    const grid = document.getElementById('subscriptions-grid');
    const stats = document.getElementById('stats');
    const filtersBar = document.getElementById('filters-bar');
    if (grid) grid.innerHTML = '';
    if (stats) stats.style.display = 'none';
    if (filtersBar) filtersBar.style.display = 'none';
}

// Update statistics display
export function renderStats(subscriptionCount, videoCount) {
    const statsEl = document.getElementById('stats');
    const subCountEl = document.getElementById('sub-count');
    const videoCountEl = document.getElementById('video-count');
    if (statsEl) statsEl.style.display = 'flex';
    if (subCountEl) subCountEl.textContent = subscriptionCount;
    if (videoCountEl) videoCountEl.textContent = videoCount;
}

// Render the video grid, or a message when there is nothing to show
export function renderVideoGrid(videos, emptyHint) {
    const grid = document.getElementById('subscriptions-grid');
    if (!grid) return;

    grid.innerHTML = '';

    if (videos.length === 0) {
        grid.innerHTML = `<div class="no-videos">Aucune vidéo disponible. ${escapeHtml(emptyHint)}</div>`;
        return;
    }

    videos.forEach(video => {
        grid.appendChild(createVideoCard(video));
    });
}

// Create video card element
function createVideoCard(video) {
    const { videoId, publishedAt, thumbnail } = video;
    const title = video.title || 'Sans titre';
    const channelTitle = video.channelTitle || 'Chaîne inconnue';

    // A real link: middle-click, "open in new tab", copy link and keyboard all work
    const hasLink = isValidYouTubeId(videoId);
    const card = document.createElement(hasLink ? 'a' : 'div');
    card.className = 'video-card';

    if (hasLink) {
        card.href = `https://www.youtube.com/watch?v=${videoId}`;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
    }

    // Structure modifiée pour le nouveau CSS (miniature décorative : le titre est déjà dans le lien)
    card.innerHTML = `
        <img class="video-thumbnail" src="${escapeHtml(thumbnail)}" alt="" loading="lazy">
        <div class="video-info">
            <div class="video-title">${escapeHtml(title)}</div>
            <div class="video-meta-row">
                <div class="video-channel">
                    <span>${escapeHtml(channelTitle)}</span>
                </div>
                <div class="video-date">${getRelativeTime(publishedAt)}</div>
            </div>
        </div>
    `;

    return card;
}

// Render the filter buttons ("Tous" + one per group); onSelect(groupName or null)
export function renderFilterButtons(groupNames, activeGroup, onSelect) {
    const filterContainer = document.getElementById('filter-buttons');
    if (!filterContainer) return;

    const filtersBar = document.getElementById('filters-bar');
    if (filtersBar) filtersBar.style.display = 'block';

    filterContainer.innerHTML = '';

    const entries = [['Tous', null], ...groupNames.map(name => [name, name])];
    entries.forEach(([label, groupName]) => {
        const button = document.createElement('button');
        button.className = groupName === activeGroup ? 'filter-button active' : 'filter-button';
        button.textContent = label;
        button.onclick = () => {
            filterContainer.querySelectorAll('.filter-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            onSelect(groupName);
        };
        filterContainer.appendChild(button);
    });
}
