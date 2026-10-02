// Sync logic: pure functions merging the data of two devices (see tests/)
//
// Synced data: { groups, hiddenGroups, watchedIds, history }. Every change made on a device is
// stamped: each element added to or removed from a set (watched videos, groups, channels of a
// group, hidden groups) keeps the time of its last change. When two devices merge, an element
// follows the device that changed it last. Elements changed on neither (stamp 0, as for data
// older than the stamps) are kept if either device has them: a first sync adds everything up.
// The order of the groups is a single value with its own stamp, and the history follows the
// watched set. The result is the same whatever the order of the merges.

import { isValidYouTubeId } from './feed.js';
import { mergeHistory } from './history-model.js';

export const SYNC_FILE_FORMAT = 'global-video-feed-sync';
const SYNC_FILE_VERSION = 1;

// Stamped sets: the data field each one is read from, and its elements
const SETS = {
    watched: { field: 'watchedIds', elements: data => [...data.watchedIds, ...Object.keys(data.history || {})] },
    groups: { field: 'groups', elements: data => Object.keys(data.groups) },
    members: { field: 'groups', elements: data => memberships(data.groups) },
    hidden: { field: 'hiddenGroups', elements: data => data.hiddenGroups }
};

// One element per channel of a group: "channelId/group" (channel IDs have no "/")
function memberships(groups) {
    return Object.entries(groups).flatMap(([name, channelIds]) => channelIds.map(id => `${id}/${name}`));
}

function splitMembership(element) {
    const slash = element.indexOf('/');
    return [element.slice(0, slash), element.slice(slash + 1)];
}

// Stamps: { last, order, watched, groups, members, hidden }, each set a Map element → time (ms).
// last is the latest stamp known, so that a new change always comes after everything seen
export function emptyStamps() {
    return { last: 0, order: 0, watched: new Map(), groups: new Map(), members: new Map(), hidden: new Map() };
}

// Copy of the stamps with the changes from before to after stamped at now (or just after the
// latest stamp known, if the clock is behind). before and after hold the fields that changed
export function stampChanges(stamps, before, after, now) {
    const stamp = Math.max(now, stamps.last + 1);
    const next = { ...stamps };
    let changed = false;

    Object.entries(SETS).forEach(([set, { field, elements }]) => {
        if (!(field in before) || !(field in after)) return;

        const old = new Set(elements(before));
        const current = new Set(elements(after));
        const diff = [...old].filter(element => !current.has(element))
            .concat([...current].filter(element => !old.has(element)));
        if (diff.length === 0) return;

        next[set] = new Map(stamps[set]);
        diff.forEach(element => next[set].set(element, stamp));
        changed = true;
    });

    // Any change to the list of groups (created, deleted, renamed, moved) stamps their order
    if ('groups' in before && 'groups' in after
        && JSON.stringify(Object.keys(before.groups)) !== JSON.stringify(Object.keys(after.groups))) {
        next.order = stamp;
        changed = true;
    }

    if (changed) next.last = stamp;
    return next;
}

// Elements of two versions of a set: each follows the side that changed it last, or is kept if
// either side has it when they changed it at the same time (or never). Order: first, then second
function mergeSet(first, second, firstStamps, secondStamps) {
    const inFirst = new Set(first);
    const inSecond = new Set(second);
    const stamps = new Map(firstStamps);
    secondStamps.forEach((stamp, element) => {
        if (!(stamps.get(element) >= stamp)) stamps.set(element, stamp);
    });

    const kept = element => {
        const a = firstStamps.get(element) || 0;
        const b = secondStamps.get(element) || 0;
        if (a === b) return inFirst.has(element) || inSecond.has(element);
        return a > b ? inFirst.has(element) : inSecond.has(element);
    };

    return { elements: [...new Set([...first, ...second])].filter(kept), stamps };
}

// Whether a's order of the groups (and of the other lists) wins over b's: the latest one, or a
// choice based on the content when they tie, so that both devices pick the same side
function orderWins(a, b) {
    if (a.stamps.order !== b.stamps.order) return a.stamps.order > b.stamps.order;

    const keysA = JSON.stringify(Object.keys(a.data.groups));
    const keysB = JSON.stringify(Object.keys(b.data.groups));
    if (keysA !== keysB) return keysA < keysB;
    return JSON.stringify(a.data) <= JSON.stringify(b.data);
}

// Merge two replicas ({ data, stamps }) into one, the same whichever is passed first
export function mergeReplicas(a, b) {
    const [first, second] = orderWins(a, b) ? [a, b] : [b, a];
    const merge = set => mergeSet(SETS[set].elements(first.data), SETS[set].elements(second.data),
        first.stamps[set], second.stamps[set]);

    const watched = merge('watched');
    const groupNames = merge('groups');
    const members = merge('members');
    const hidden = merge('hidden');

    // Channels of the groups that are kept, in the order of the winning side, then the other's
    const channels = new Map(groupNames.elements.map(name => [name, []]));
    members.elements.forEach(element => {
        const [channelId, name] = splitMembership(element);
        channels.get(name)?.push(channelId);
    });

    const keep = new Set(watched.elements);
    return {
        data: {
            groups: Object.fromEntries(channels),
            hiddenGroups: hidden.elements,
            watchedIds: watched.elements,
            history: mergeHistory(first.data.history, second.data.history, videoId => keep.has(videoId))
        },
        stamps: {
            last: Math.max(a.stamps.last, b.stamps.last),
            order: Math.max(a.stamps.order, b.stamps.order),
            watched: watched.stamps,
            groups: groupNames.stamps,
            members: members.stamps,
            hidden: hidden.stamps
        }
    };
}

// Whether two replicas hold the same data and stamps
export function sameReplica(a, b) {
    return JSON.stringify(toSyncFile(a, 0)) === JSON.stringify(toSyncFile(b, 0));
}

// --- Storage format ---

// Stamps as JSON: each set as { time: [elements changed at that time] }, which stays small when
// many elements change at once (an import, "Effacer tout l'historique")
export function packStamps(stamps) {
    const packSet = set => {
        const byTime = {};
        set.forEach((stamp, element) => { (byTime[stamp] ||= []).push(element); });
        return byTime;
    };
    return {
        last: stamps.last,
        order: stamps.order,
        ...Object.fromEntries(Object.keys(SETS).map(set => [set, packSet(stamps[set])]))
    };
}

// Stamps read back from JSON; anything unreadable counts as never changed
export function unpackStamps(packed) {
    const stamps = emptyStamps();
    if (!packed || typeof packed !== 'object') return stamps;

    const time = value => (Number.isFinite(value) && value > 0 ? value : 0);
    stamps.last = time(packed.last);
    stamps.order = time(packed.order);

    Object.keys(SETS).forEach(set => {
        Object.entries(packed[set] && typeof packed[set] === 'object' ? packed[set] : {}).forEach(([key, elements]) => {
            const stamp = time(Number(key));
            if (!stamp || !Array.isArray(elements)) return;
            elements.forEach(element => {
                if (typeof element === 'string' && !(stamps[set].get(element) >= stamp)) stamps[set].set(element, stamp);
            });
        });
        stamps[set].forEach(stamp => { stamps.last = Math.max(stamps.last, stamp); });
    });
    stamps.last = Math.max(stamps.last, stamps.order);
    return stamps;
}

// Content of the sync file shared by the devices
export function toSyncFile(replica, savedAt) {
    return {
        format: SYNC_FILE_FORMAT,
        version: SYNC_FILE_VERSION,
        savedAt: new Date(savedAt).toISOString(),
        data: replica.data,
        stamps: packStamps(replica.stamps)
    };
}

// Replica of a sync file. Throws if it is not one, or comes from a newer version of the app;
// skips values of the wrong type
export function fromSyncFile(file) {
    if (!file || file.format !== SYNC_FILE_FORMAT || typeof file.data !== 'object' || !file.data) {
        throw new Error('Not a sync file');
    }
    if (file.version > SYNC_FILE_VERSION) {
        throw new Error('Sync file from a newer version');
    }

    const { groups, hiddenGroups, watchedIds, history } = file.data;
    const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const strings = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);

    return {
        data: {
            groups: Object.fromEntries(Object.entries(isObject(groups) ? groups : {})
                .map(([name, ids]) => [name, strings(ids).filter(isValidYouTubeId)])),
            hiddenGroups: strings(hiddenGroups),
            watchedIds: strings(watchedIds).filter(isValidYouTubeId),
            history: Object.fromEntries(Object.entries(isObject(history) ? history : {})
                .filter(([videoId, entry]) => isValidYouTubeId(videoId) && isObject(entry)
                    && Number.isFinite(entry.watchedAt) && isObject(entry.video)))
        },
        stamps: unpackStamps(file.stamps)
    };
}
