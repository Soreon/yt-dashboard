// Groups logic: pure functions on { group name: [channelId, ...] } (see tests/)

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
