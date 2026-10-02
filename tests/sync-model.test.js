import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_HISTORY } from '../js/config.js';
import {
    emptyStamps, fromSyncFile, mergeReplicas, packStamps, sameReplica, stampChanges, toSyncFile, unpackStamps
} from '../js/sync-model.js';

// A device's synced data, never changed since the stamps exist
function device(data = {}) {
    return { data: { groups: {}, hiddenGroups: [], watchedIds: [], history: {}, ...data }, stamps: emptyStamps() };
}

// A change made on a device at a given time, stamped as storage.js does
function change(replica, fields, now) {
    const before = Object.fromEntries(Object.keys(fields).map(field => [field, replica.data[field]]));
    return { data: { ...replica.data, ...fields }, stamps: stampChanges(replica.stamps, before, fields, now) };
}

const entry = (videoId, watchedAt) => ({ watchedAt, video: { videoId, title: `Titre ${videoId}` } });

// Both devices end up with the same data after syncing, whatever the order
function sync(a, b) {
    const merged = mergeReplicas(a, b);
    assert.ok(sameReplica(merged, mergeReplicas(b, a)), 'the merge does not depend on the order');
    assert.ok(sameReplica(merged, mergeReplicas(merged, merged)), 'merging again changes nothing');
    return merged;
}

test('stampChanges stamps each element added or removed, and the order of the groups', () => {
    const before = device({ groups: { Tech: ['UC_A'], Jeux: ['UC_B'] }, watchedIds: ['v1'] });
    const after = change(before, { groups: { Jeux: ['UC_B', 'UC_C'], Sport: [] } }, 1000);

    assert.deepEqual([...after.stamps.groups], [['Tech', 1000], ['Sport', 1000]]);
    assert.deepEqual([...after.stamps.members], [['UC_A/Tech', 1000], ['UC_C/Jeux', 1000]]);
    assert.equal(after.stamps.order, 1000);
    assert.equal(after.stamps.watched.size, 0, 'the other sets are not touched');
    assert.equal(after.stamps.last, 1000);

    // Same groups in the same order: nothing to stamp
    assert.equal(change(after, { groups: { Jeux: ['UC_B', 'UC_C'], Sport: [] } }, 2000).stamps.last, 1000);
});

test('stampChanges stamps after the latest known change, even if the clock went back', () => {
    const later = change(device(), { watchedIds: ['v1'] }, 5000);
    const next = change(later, { watchedIds: [] }, 3000);
    assert.equal(next.stamps.watched.get('v1'), 5001);
    assert.equal(next.stamps.last, 5001);
});

test('a first sync adds up the data of both devices', () => {
    const a = device({ groups: { Tech: ['UC_A'] }, hiddenGroups: ['Tech'], watchedIds: ['v1'], history: { v1: entry('v1', 10) } });
    const b = device({ groups: { Tech: ['UC_B'], Jeux: ['UC_C'] }, watchedIds: ['v2'], history: { v2: entry('v2', 20) } });

    const { data } = sync(a, b);
    assert.deepEqual(data.groups, { Jeux: ['UC_C'], Tech: ['UC_B', 'UC_A'] });
    assert.deepEqual(data.hiddenGroups, ['Tech']);
    assert.deepEqual(data.watchedIds.sort(), ['v1', 'v2']);
    assert.deepEqual(Object.keys(data.history).sort(), ['v1', 'v2']);
});

test('a video marked as not watched on one device is not watched on the other either', () => {
    const base = device({ watchedIds: ['v1', 'v2'], history: { v1: entry('v1', 10), v2: entry('v2', 20) } });
    const a = change(base, { watchedIds: ['v2'], history: { v2: entry('v2', 20) } }, 1000);

    const merged = sync(a, base);
    assert.deepEqual(merged.data.watchedIds, ['v2']);
    assert.deepEqual(Object.keys(merged.data.history), ['v2']);

    // Watched again later on the other device: it is watched again everywhere
    const b = change(merged, { watchedIds: ['v2', 'v1'], history: { ...merged.data.history, v1: entry('v1', 2000) } }, 2000);
    const again = sync(b, a);
    assert.deepEqual(again.data.watchedIds.sort(), ['v1', 'v2']);
    assert.equal(again.data.history.v1.watchedAt, 2000);
});

test('clearing the history on one device clears it on the other, and a later import still counts', () => {
    const base = device({ watchedIds: ['v1', 'v2'], history: { v1: entry('v1', 10) } });
    const cleared = change(base, { watchedIds: [], history: {} }, 1000);
    const merged = sync(cleared, base);
    assert.deepEqual(merged.data.watchedIds, []);
    assert.deepEqual(merged.data.history, {});

    const imported = change(merged, { watchedIds: ['v1', 'v3'], history: { v1: entry('v1', 10) } }, 2000);
    assert.deepEqual(sync(imported, cleared).data.watchedIds, ['v1', 'v3']);
});

test('changes to different groups on two devices are all kept', () => {
    const base = device({ groups: { Tech: ['UC_A'], Jeux: ['UC_B'], Vieux: ['UC_D'] } });
    const a = change(base, { groups: { Tech: ['UC_A', 'UC_C'], Jeux: ['UC_B'] } }, 1000); // Adds to Tech, deletes Vieux
    const b = change(base, { groups: { Tech: ['UC_A'], Jeux: [], Vieux: ['UC_D'] } }, 1500); // Empties Jeux

    assert.deepEqual(sync(a, b).data.groups, { Tech: ['UC_A', 'UC_C'], Jeux: [] });
});

test('a group renamed on one device is renamed on the other, with its channels', () => {
    const base = device({ groups: { Tech: ['UC_A', 'UC_B'], Jeux: ['UC_C'] }, hiddenGroups: ['Tech'] });
    const a = change(change(base, { groups: { Techno: ['UC_A', 'UC_B'], Jeux: ['UC_C'] } }, 1000), { hiddenGroups: ['Techno'] }, 1000);

    const { data } = sync(a, base);
    assert.deepEqual(data.groups, { Techno: ['UC_A', 'UC_B'], Jeux: ['UC_C'] });
    assert.deepEqual(data.hiddenGroups, ['Techno']);
});

test('the latest order of the groups wins, and groups created elsewhere go at the end', () => {
    const base = device({ groups: { Tech: [], Jeux: [], Sport: [] } });
    const reordered = change(base, { groups: { Sport: [], Tech: [], Jeux: [] } }, 2000);
    const created = change(base, { groups: { Tech: [], Jeux: [], Sport: [], Cuisine: [] } }, 1000);

    assert.deepEqual(Object.keys(sync(reordered, created).data.groups), ['Sport', 'Tech', 'Jeux', 'Cuisine']);
});

test('the merged history keeps the latest watch of each video, and only the most recent ones', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_HISTORY }, (_, i) => [`a${i}`, entry(`a${i}`, 100 + i)]));
    const a = device({ watchedIds: Object.keys(many), history: { ...many, v1: entry('v1', 50) } });
    const b = device({ watchedIds: ['v1', 'v2'], history: { v1: entry('v1', 5000), v2: entry('v2', 10) } });

    const { history } = sync(a, b).data;
    assert.equal(Object.keys(history).length, MAX_HISTORY);
    assert.equal(history.v1.watchedAt, 5000);
    assert.equal(history.v2, undefined, 'the oldest watch is left out');
    assert.equal(history.a0, undefined);
});

test('devices changing things at random and syncing in any order all end up with the same data', () => {
    let seed = 42;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pick = items => items[Math.floor(random() * items.length)];
    const names = ['Tech', 'Jeux', 'Sport', 'Favoris'];
    const channels = ['UC_A', 'UC_B', 'UC_C', 'UC_D'];
    const videos = ['v1', 'v2', 'v3', 'v4', 'v5'];

    // One random change, as the app would make it
    function randomChange(replica, now) {
        const { groups, hiddenGroups, watchedIds, history } = replica.data;
        const name = pick(names);
        const channel = pick(channels);
        const video = pick(videos);
        switch (Math.floor(random() * 6)) {
            case 0: return change(replica, { groups: { ...groups, [name]: [...new Set([...(groups[name] || []), channel])] } }, now);
            case 1: return change(replica, { groups: Object.fromEntries(Object.entries(groups).filter(([groupName]) => groupName !== name)) }, now);
            case 2: return change(replica, { groups: Object.fromEntries(Object.entries(groups).reverse()) }, now);
            case 3: return change(replica, { hiddenGroups: hiddenGroups.includes(name) ? hiddenGroups.filter(n => n !== name) : [...hiddenGroups, name] }, now);
            case 4: return change(replica, { watchedIds: [...new Set([...watchedIds, video])], history: { ...history, [video]: entry(video, now) } }, now);
            default: return change(replica, {
                watchedIds: watchedIds.filter(id => id !== video),
                history: Object.fromEntries(Object.entries(history).filter(([id]) => id !== video))
            }, now);
        }
    }

    const devices = [device(), device(), device()];
    let remote = device();
    for (let now = 1; now <= 400; now++) {
        const index = Math.floor(random() * devices.length);
        if (random() < 0.6) {
            devices[index] = randomChange(devices[index], now * 10);
        } else {
            remote = mergeReplicas(devices[index], remote);
            devices[index] = remote;
        }
    }

    // Everyone syncs twice: all the same
    for (let round = 0; round < 2; round++) {
        devices.forEach((replica, index) => {
            remote = mergeReplicas(replica, remote);
            devices[index] = remote;
        });
    }
    devices.forEach(replica => assert.ok(sameReplica(replica, remote)));
    assert.ok(Object.keys(remote.data.history).every(id => remote.data.watchedIds.includes(id)));
});

test('group names that are also object properties are handled like any other', () => {
    const a = change(device(), { groups: JSON.parse('{ "constructor": ["UC_A"], "__proto__": ["UC_B"] }') }, 1000);
    assert.deepEqual(Object.entries(sync(a, device()).data.groups), [['constructor', ['UC_A']], ['__proto__', ['UC_B']]]);
});

test('stamps and sync files read back what was written', () => {
    let replica = change(device({ watchedIds: ['v1'] }), { watchedIds: ['v2', 'v3'], groups: { Tech: ['UC_A'] } }, 1000);
    replica = change(replica, { hiddenGroups: ['Tech'] }, 2000);

    const packed = packStamps(replica.stamps);
    assert.deepEqual(packed.watched, { 1000: ['v1', 'v2', 'v3'] }, 'elements changed together share their time');
    assert.deepEqual(unpackStamps(JSON.parse(JSON.stringify(packed))), replica.stamps);

    const file = JSON.parse(JSON.stringify(toSyncFile(replica, Date.parse('2026-10-02T12:00:00Z'))));
    assert.equal(file.savedAt, '2026-10-02T12:00:00.000Z');
    assert.ok(sameReplica(fromSyncFile(file), replica));
});

test('fromSyncFile rejects other files and newer versions, and skips invalid values', () => {
    assert.throws(() => fromSyncFile(null));
    assert.throws(() => fromSyncFile({ format: 'global-video-feed-groups', data: {} }));
    assert.throws(() => fromSyncFile({ format: 'global-video-feed-sync', version: 2, data: {} }), /newer/);

    const { data, stamps } = fromSyncFile({
        format: 'global-video-feed-sync',
        version: 1,
        data: {
            groups: { Tech: ['UC_A', 'pas valide !', 42], Liste: 'non' },
            hiddenGroups: ['Tech', null],
            watchedIds: ['v1', '<script>'],
            history: { v1: entry('v1', 10), v2: { watchedAt: 'hier' }, 'x y': entry('x y', 10) }
        },
        stamps: { last: 'non', watched: { 1000: ['v1', 7], abc: ['v2'] } }
    });
    assert.deepEqual(data, { groups: { Tech: ['UC_A'], Liste: [] }, hiddenGroups: ['Tech'], watchedIds: ['v1'], history: { v1: entry('v1', 10) } });
    assert.deepEqual([...stamps.watched], [['v1', 1000]]);
    assert.equal(stamps.last, 1000);
});
