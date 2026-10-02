// DOM rendering helpers

import { formatDuration, formatViews, getRelativeTime, isValidYouTubeId } from './feed.js';
import { FAVORITES_GROUP } from './groups-model.js';

// Star next to the name of the favorites group (chip, card)
export const FAVORITES_ICON = '<svg class="favorites-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';

// Escape HTML to prevent XSS, in text and in quoted attribute values
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

// Show a message at the bottom left, optionally with an action button ({ label, onClick })
let toastTimeout = null;
export function showToast(message, action = null) {
    const toastEl = document.getElementById('error-message');
    if (!toastEl) return;

    const text = document.createElement('span');
    text.textContent = message;
    toastEl.replaceChildren(text);

    if (action) {
        const button = document.createElement('button');
        button.className = 'toast-action';
        button.textContent = action.label;
        button.addEventListener('click', () => {
            toastEl.style.display = 'none';
            action.onClick();
        });
        toastEl.appendChild(button);
    }

    toastEl.style.display = 'flex';
    // Restart the timer so a new message is not hidden by an older one
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toastEl.style.display = 'none';
    }, 5000);
}

// Save data as a JSON file (browser download)
export function downloadJson(filename, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Show error message (toast)
export function showError(message) {
    showToast(message);
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

// "Nouvelles vidéos" pill; onClick shows them
export function showNewVideosPill(onClick) {
    const pill = document.getElementById('new-videos-pill');
    if (!pill) return;
    pill.onclick = onClick;
    pill.hidden = false;
}

export function hideNewVideosPill() {
    const pill = document.getElementById('new-videos-pill');
    if (pill) pill.hidden = true;
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

// Account menu: toggled by the avatar, closed by a click outside or Escape; onOpen() is called
// when it opens, to bring its content up to date
export function setupAccountMenu(onOpen = () => {}) {
    const button = document.getElementById('account-button');
    const menu = document.getElementById('account-menu');
    if (!button || !menu) return;

    button.addEventListener('click', event => {
        event.stopPropagation();
        const open = menu.hidden;
        if (open) onOpen();
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

// Drive sync switch of the account menu, and its status line
export function renderDriveSync(enabled, status) {
    document.getElementById('drive-sync-toggle')?.setAttribute('aria-checked', String(enabled));
    const statusEl = document.getElementById('drive-sync-status');
    if (statusEl) statusEl.textContent = status;
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

const ICON_MARK_WATCHED = 'M22 5.18 10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zm-2.21 5.04c.13.57.21 1.17.21 1.78 0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8c1.58 0 3.04.46 4.28 1.25l1.44-1.44A9.9 9.9 0 0 0 12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10c0-1.19-.22-2.33-.6-3.39l-1.61 1.61z';
const ICON_MARK_UNWATCHED = 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z';
const ICON_REMOVE = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

function setIconButton(button, path, label) {
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    button.setAttribute('aria-label', label);
    button.title = label;
}

// Show a feed card as watched (dimmed, red bar) or not, and switch its button
export function markCardWatched(card, watched) {
    card.classList.toggle('watched', watched);
    const button = card.querySelector('.card-action');
    if (button) {
        setIconButton(button, watched ? ICON_MARK_UNWATCHED : ICON_MARK_WATCHED,
            watched ? 'Marquer comme non vue' : 'Marquer comme vue');
    }
}

// Call onOpen(video, card) when a link to the video is followed (click, middle click, Enter)
function onVideoLinkOpened(card, video, onOpen) {
    card.querySelectorAll('a.thumbnail, a.video-title-link').forEach(link => {
        link.addEventListener('click', () => onOpen(video, card));
        link.addEventListener('auxclick', event => {
            if (event.button === 1) onOpen(video, card);
        });
    });
}

// Cards added at a time (fills rows of 2, 3, 4 or 6): the next ones come while scrolling down
const FEED_PAGE_SIZE = 48;
let feedObserver = null;
let feedShown = 0; // Cards the last render showed

// Render the video grid, or a message when there is nothing to show. A long feed is rendered a
// page at a time, the next page when the end comes near (marker at the end of the grid).
// handlers: { onOpen(video, card), onToggleWatched(video, card) }
export function renderVideoGrid(videos, emptyMessage, channelAvatars = {}, handlers = {}) {
    const grid = document.getElementById('subscriptions-grid');
    if (!grid) return;

    // Before emptying the grid, which brings the page back up
    const scrolledDown = window.scrollY > 0;
    feedObserver?.disconnect();
    feedObserver = null;
    grid.innerHTML = '';

    if (videos.length === 0) {
        grid.innerHTML = `<div class="no-videos">${escapeHtml(emptyMessage)}</div>`;
        return;
    }

    const createCard = video => {
        const card = createVideoCard(video, channelAvatars[video.channelId]);

        const action = document.createElement('button');
        action.className = 'icon-button card-action';
        action.addEventListener('click', () => handlers.onToggleWatched?.(video, card));
        card.querySelector('.details').appendChild(action);
        markCardWatched(card, false);

        if (handlers.onOpen) onVideoLinkOpened(card, video, handlers.onOpen);
        return card;
    };

    const marker = document.createElement('div');
    marker.className = 'feed-more';
    grid.appendChild(marker);

    let shown = 0;
    const showMore = (count = FEED_PAGE_SIZE) => {
        const page = document.createDocumentFragment();
        videos.slice(shown, shown + count).forEach(video => page.appendChild(createCard(video)));
        marker.before(page);
        shown += count;
        feedShown = Math.min(shown, videos.length);
    };

    // Rendered again below the top (a video marked as watched, a sync): as many cards as before,
    // so that the page does not shrink and jump up
    showMore(scrolledDown ? Math.max(FEED_PAGE_SIZE, feedShown) : FEED_PAGE_SIZE);
    if (shown >= videos.length || typeof IntersectionObserver === 'undefined') {
        while (shown < videos.length) showMore();
        marker.remove();
        return;
    }

    feedObserver = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        showMore();
        if (shown >= videos.length) {
            feedObserver.disconnect();
            feedObserver = null;
            marker.remove();
            return;
        }
        // Observing again reports at once whether the marker is still near (very tall screen)
        feedObserver.unobserve(marker);
        feedObserver.observe(marker);
    }, { rootMargin: '0px 0px 1500px 0px' });
    feedObserver.observe(marker);
}

// Render the history page: day headings, then one row per video.
// handlers: { onOpen(video, card), onRemove(videoId) }
export function renderHistory(dayGroups, emptyMessage, channelAvatars = {}, handlers = {}) {
    const list = document.getElementById('history-list');
    if (!list) return;

    list.innerHTML = '';

    if (dayGroups.length === 0) {
        list.innerHTML = `<div class="no-videos">${escapeHtml(emptyMessage)}</div>`;
        return;
    }

    dayGroups.forEach(({ label, entries }) => {
        const heading = document.createElement('h2');
        heading.className = 'history-day';
        heading.textContent = label;
        list.appendChild(heading);

        entries.forEach(({ video }) => {
            const card = createVideoCard(video, channelAvatars[video.channelId]);
            card.classList.add('history-item', 'watched');

            const remove = document.createElement('button');
            remove.className = 'icon-button card-action';
            setIconButton(remove, ICON_REMOVE, "Retirer de l'historique");
            remove.addEventListener('click', () => handlers.onRemove?.(video.videoId));
            card.appendChild(remove);

            if (handlers.onOpen) onVideoLinkOpened(card, video, handlers.onOpen);
            list.appendChild(card);
        });
    });
}

// "Tout marquer comme vu" button of the filters bar, for the count videos of a filtered feed
// (0: hidden)
export function showMarkAllWatched(count) {
    const button = document.getElementById('mark-all-watched');
    if (!button) return;

    button.hidden = count === 0;
    const label = count === 1 ? 'Marquer la vidéo comme vue' : `Marquer les ${count} vidéos comme vues`;
    button.title = label;
    button.setAttribute('aria-label', label);
}

// Lay out the feed as a grid of cards or a compact list ('grid' or 'list'), and check the
// matching side of the toggle. The cards are the same, only the CSS changes
export function setFeedLayout(layout) {
    const grid = document.getElementById('subscriptions-grid');
    if (grid) grid.className = layout === 'list' ? 'video-list' : 'video-grid';

    document.querySelectorAll('.layout-toggle-button').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
    });
}

// Show the feed, the groups or the history page, and highlight it in the navigation
export function setActiveView(view) {
    ['feed', 'groups', 'history'].forEach(name => {
        document.getElementById(`${name}-view`).hidden = name !== view;
    });

    document.querySelectorAll('.nav-link').forEach(link => {
        const active = link.dataset.view === view;
        link.classList.toggle('active', active);
        if (active) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
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
    // [class, text]: the list layout shows each one in its own column
    const stats = [['video-views', formatViews(video.views)], ['video-age', publishedAt && getRelativeTime(publishedAt)]]
        .filter(([, text]) => text);

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
                <div class="video-stats">${stats.map(([className, text]) => `<span class="${className}">${escapeHtml(text)}</span>`).join('')}</div>
            </div>
        </div>
    `;

    setAvatar(card.querySelector('.avatar'), channelAvatar, channelTitle);
    return card;
}

// Render the filter chips: "Tous", one per group, and the channel filter when one is active.
// onSelectGroup(groupName or null) on a chip, onClearChannel() on the channel chip
export function renderFilterButtons({ groupNames, activeGroup, activeChannel, onSelectGroup, onClearChannel }) {
    const filterContainer = document.getElementById('filter-buttons');
    if (!filterContainer) return;

    const filtersBar = document.getElementById('filters-bar');
    if (filtersBar) filtersBar.style.display = 'flex';

    filterContainer.innerHTML = '';

    const entries = [['Tous', null], ...groupNames.map(name => [name, name])];
    entries.forEach(([label, groupName]) => {
        const button = document.createElement('button');
        const active = !activeChannel && groupName === activeGroup;
        button.className = active ? 'chip filter-button active' : 'chip filter-button';
        button.textContent = label;
        if (groupName === FAVORITES_GROUP) {
            button.classList.add('favorites-chip');
            button.insertAdjacentHTML('afterbegin', FAVORITES_ICON);
        }
        button.onclick = () => onSelectGroup(groupName);
        filterContainer.appendChild(button);
    });

    if (activeChannel) {
        const chip = document.createElement('button');
        chip.className = 'chip filter-button channel-chip active';
        chip.title = 'Retirer le filtre';
        chip.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        chip.querySelector('span').textContent = activeChannel.name;
        chip.onclick = onClearChannel;
        filterContainer.appendChild(chip);
    }
}
