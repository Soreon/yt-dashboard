// Groups logic: pure functions on { group name: [channelId, ...] } (see tests/)

import { isValidYouTubeId } from './feed.js';

const EXPORT_FORMAT = 'global-video-feed-groups';
const MAX_GROUP_NAME_LENGTH = 60; // Same limit as the name field of the editor

// Create a group, or update one (originalName set), keeping the groups order.
// Returns { groups } with a new object, or { error } with a message for the user
export function upsertGroup(groups, { originalName = null, name, channelIds }) {
    const groupName = (name || '').trim();

    if (!groupName) {
        return { error: 'Veuillez entrer un nom de groupe' };
    }

    if (groupName !== originalName && Object.hasOwn(groups, groupName)) {
        return { error: `Un groupe nommé « ${groupName} » existe déjà` };
    }

    if (originalName === null || !Object.hasOwn(groups, originalName)) {
        return { groups: { ...groups, [groupName]: [...channelIds] } };
    }

    // Rename in place so the group keeps its position among the filters
    return {
        groups: Object.fromEntries(Object.entries(groups).map(([existingName, existingIds]) =>
            existingName === originalName ? [groupName, [...channelIds]] : [existingName, existingIds]
        ))
    };
}

// Copy of the groups without the given one
export function removeGroup(groups, name) {
    return Object.fromEntries(Object.entries(groups).filter(([groupName]) => groupName !== name));
}

// Rename a group, keeping its channels and its position
export function renameGroup(groups, from, to) {
    return upsertGroup(groups, { originalName: from, name: to, channelIds: groups[from] || [] });
}

// Copy of the groups with channels added to one (a channel may belong to several groups)
export function addToGroup(groups, name, channelIds) {
    const existing = groups[name] || [];
    return { ...groups, [name]: [...new Set([...existing, ...channelIds])] };
}

// Copy of the groups with a channel removed from one
export function removeFromGroup(groups, name, channelId) {
    if (!groups[name]) return groups;
    return { ...groups, [name]: groups[name].filter(id => id !== channelId) };
}

// Names of the groups a channel belongs to, in the groups order
export function groupsOfChannel(groups, channelId) {
    return Object.entries(groups).filter(([, ids]) => ids.includes(channelId)).map(([name]) => name);
}

// Subscribed channels (channelIds) that belong to no group
export function ungroupedChannels(groups, channelIds) {
    const grouped = new Set(Object.values(groups).flat());
    return channelIds.filter(id => !grouped.has(id));
}

// What the cache knows about a channel: date of its latest video, and videos not watched yet
export function channelActivity(channelId, videoCache, history) {
    let lastUpload = null;
    let unwatched = 0;

    (videoCache[channelId] || []).forEach(video => {
        if (video.publishedAt && (!lastUpload || video.publishedAt > lastUpload)) {
            lastUpload = video.publishedAt;
        }
        if (!history[video.videoId]) unwatched++;
    });

    return { lastUpload, unwatched };
}

// Same for a whole group: latest video of any channel, sum of unwatched videos
export function groupActivity(channelIds, videoCache, history) {
    return channelIds.reduce((total, channelId) => {
        const { lastUpload, unwatched } = channelActivity(channelId, videoCache, history);
        return {
            lastUpload: lastUpload && (!total.lastUpload || lastUpload > total.lastUpload) ? lastUpload : total.lastUpload,
            unwatched: total.unwatched + unwatched
        };
    }, { lastUpload: null, unwatched: 0 });
}

// Content of a groups file: each group with its channels (ID, and name so the file is readable)
export function exportGroups(groups, channelNames, exportedAt) {
    return {
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt: new Date(exportedAt).toISOString(),
        groups: Object.entries(groups).map(([name, channelIds]) => ({
            name,
            channels: channelIds.map(id => ({ id, name: channelNames[id] || '' }))
        }))
    };
}

// Groups of an exported file: [{ name, channelIds }]. Throws if it is not such a file;
// skips groups without a name or without a valid channel
export function parseGroupsFile(data) {
    if (!data || data.format !== EXPORT_FORMAT || !Array.isArray(data.groups)) {
        throw new Error('Not a groups file');
    }

    return data.groups
        .map(group => ({
            name: String(group?.name ?? '').trim().slice(0, MAX_GROUP_NAME_LENGTH),
            channelIds: [...new Set((Array.isArray(group?.channels) ? group.channels : [])
                .map(channel => channel?.id)
                .filter(id => typeof id === 'string' && isValidYouTubeId(id)))]
        }))
        .filter(group => group.name && group.channelIds.length > 0);
}

// Copy of the groups with other groups added; a group with a name already used gets the channels
// it was missing instead (nothing is removed). Returns { groups, added, completed }
export function mergeGroups(groups, incoming) {
    const merged = { ...groups };
    let added = 0;
    let completed = 0;

    incoming.forEach(({ name, channelIds }) => {
        const existing = merged[name];
        if (!existing) {
            merged[name] = [...channelIds];
            added++;
            return;
        }

        const missing = channelIds.filter(id => !existing.includes(id));
        if (missing.length > 0) {
            merged[name] = [...existing, ...missing];
            completed++;
        }
    });

    return { groups: merged, added, completed };
}
