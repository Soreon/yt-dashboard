// DOM rendering helpers

import { formatDuration, formatViews, getRelativeTime, isValidYouTubeId } from './feed.js';

// Escape HTML to prevent XSS
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show error message (toast)
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

// Show/hide the progress bar at the top of the page
export function setLoading(isLoading, message = 'Chargement des abonnements...') {
    const loadingEl = document.getElementById('loading');
    if (!loadingEl) return;

    loadingEl.setAttribute('aria-label', message);
    loadingEl.style.display = isLoading ? 'block' : 'none';
}

// Spin the sync button while a sync runs
export function setSyncing(isSyncing) {
    document.getElementById('force-sync-button')?.classList.toggle('spinning', isSyncing);
}

// Update authentication UI
export function updateAuthUI(isAuthenticated) {
    const show = (id, visible, display = 'inline-flex') => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? display : 'none';
    };

    // Si connecté, on cache le bouton de connexion et on affiche le compte, sinon l'inverse
    show('authorize-button', !isAuthenticated);
    show('account', isAuthenticated, 'block');
    show('force-sync-button', isAuthenticated);
    show('manage-groups-button', isAuthenticated);

    if (!isAuthenticated) {
        closeAccountMenu();
    }
}

// Fill an avatar element with an image, or the first letter of the name as a fallback
export function setAvatar(element, url, name) {
    if (!element) return;

    const initial = (name || '?').trim().charAt(0);
    element.textContent = '';

    if (!url) {
        element.textContent = initial;
        return;
    }

    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { element.textContent = initial; };
    img.src = url;
    element.appendChild(img);
}

// Signed-in user's name and avatar ({ name, avatar } or null)
export function renderAccount(account) {
    const name = account?.name || 'Compte YouTube';
    setAvatar(document.getElementById('account-avatar'), account?.avatar, name);
    setAvatar(document.getElementById('account-menu-avatar'), account?.avatar, name);

    const nameEl = document.getElementById('account-name');
    if (nameEl) nameEl.textContent = name;
}

// Account menu: toggled by the avatar, closed by a click outside or Escape
export function setupAccountMenu() {
    const button = document.getElementById('account-button');
    const menu = document.getElementById('account-menu');
    if (!button || !menu) return;

    button.addEventListener('click', event => {
        event.stopPropagation();
        const open = menu.hidden;
        menu.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('click', event => {
        if (!menu.hidden && !menu.contains(event.target)) closeAccountMenu();
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeAccountMenu();
    });
}

function closeAccountMenu() {
    const menu = document.getElementById('account-menu');
    if (menu) menu.hidden = true;
    document.getElementById('account-button')?.setAttribute('aria-expanded', 'false');
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
    if (statsEl) statsEl.style.display = 'block';
    if (subCountEl) subCountEl.textContent = subscriptionCount;
    if (videoCountEl) videoCountEl.textContent = videoCount;
}

// Render the video grid, or a message when there is nothing to show
export function renderVideoGrid(videos, emptyMessage, channelAvatars = {}) {
    const grid = document.getElementById('subscriptions-grid');
    if (!grid) return;

    grid.innerHTML = '';

    if (videos.length === 0) {
        grid.innerHTML = `<div class="no-videos">${escapeHtml(emptyMessage)}</div>`;
        return;
    }

    videos.forEach(video => {
        grid.appendChild(createVideoCard(video, channelAvatars[video.channelId]));
    });
}

// Create a video card, laid out like YouTube's: thumbnail, then avatar, title, channel and stats.
// Thumbnail and title link to the video, avatar and channel name to the channel
function createVideoCard(video, channelAvatar) {
    const { videoId, channelId, publishedAt, thumbnail } = video;
    const title = video.title || 'Sans titre';
    const channelTitle = video.channelTitle || 'Chaîne inconnue';

    const videoUrl = isValidYouTubeId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
    const channelUrl = isValidYouTubeId(channelId) ? `https://www.youtube.com/channel/${channelId}` : null;
    const link = (url, className, content, extra = '') => url
        ? `<a class="${className}" href="${url}" target="_blank" rel="noopener noreferrer" ${extra}>${content}</a>`
        : `<span class="${className}">${content}</span>`;

    const duration = formatDuration(video.duration);
    const stats = [formatViews(video.views), getRelativeTime(publishedAt)].filter(Boolean);

    const card = document.createElement('div');
    card.className = 'video-card';

    // Thumbnail and avatar are decorative duplicates of the title and channel links
    card.innerHTML = `
        ${link(videoUrl, 'thumbnail', `
            <img src="${escapeHtml(thumbnail)}" alt="" loading="lazy">
            ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
        `, 'tabindex="-1" aria-hidden="true"')}
        <div class="details">
            ${link(channelUrl, 'channel-avatar', '<span class="avatar"></span>', 'tabindex="-1" aria-hidden="true"')}
            <div class="meta">
                <h3 class="video-title">${link(videoUrl, 'video-title-link', escapeHtml(title), `title="${escapeHtml(title)}"`)}</h3>
                ${link(channelUrl, 'channel-name', escapeHtml(channelTitle))}
                <div class="video-stats">${stats.map(text => `<span>${escapeHtml(text)}</span>`).join('')}</div>
            </div>
        </div>
    `;

    setAvatar(card.querySelector('.avatar'), channelAvatar, channelTitle);
    return card;
}

// Render the filter chips ("Tous" + one per group); onSelect(groupName or null)
export function renderFilterButtons(groupNames, activeGroup, onSelect) {
    const filterContainer = document.getElementById('filter-buttons');
    if (!filterContainer) return;

    const filtersBar = document.getElementById('filters-bar');
    if (filtersBar) filtersBar.style.display = 'flex';

    filterContainer.innerHTML = '';

    const entries = [['Tous', null], ...groupNames.map(name => [name, name])];
    entries.forEach(([label, groupName]) => {
        const button = document.createElement('button');
        button.className = groupName === activeGroup ? 'chip filter-button active' : 'chip filter-button';
        button.textContent = label;
        button.onclick = () => {
            filterContainer.querySelectorAll('.filter-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            onSelect(groupName);
        };
        filterContainer.appendChild(button);
    });
}
