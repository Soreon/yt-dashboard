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

    if (channelIds.length === 0) {
        return { error: 'Veuillez sélectionner au moins une chaîne' };
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
