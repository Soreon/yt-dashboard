import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    addToGroup, channelActivity, exportGroups, groupActivity, groupsOfChannel, mergeGroups, parseGroupsFile,
    removeFromGroup, removeGroup, renameGroup, ungroupedChannels, upsertGroup
} from '../js/groups-model.js';

const groups = { Tech: ['A', 'B'], Musique: ['C'], Jeux: ['D'] };

test('upsertGroup creates a group at the end, with a trimmed name', () => {
    const { groups: result, error } = upsertGroup(groups, { name: '  Cuisine ', channelIds: ['E'] });
    assert.equal(error, undefined);
    assert.deepEqual(Object.keys(result), ['Tech', 'Musique', 'Jeux', 'Cuisine']);
    assert.deepEqual(result.Cuisine, ['E']);
    assert.equal(groups.Cuisine, undefined, 'the original groups are not modified');
});

test('upsertGroup updates the channels of an existing group', () => {
    const { groups: result } = upsertGroup(groups, { originalName: 'Musique', name: 'Musique', channelIds: ['C', 'F'] });
    assert.deepEqual(result.Musique, ['C', 'F']);
    assert.deepEqual(Object.keys(result), ['Tech', 'Musique', 'Jeux']);
});

test('upsertGroup renames a group in place', () => {
    const { groups: result } = upsertGroup(groups, { originalName: 'Musique', name: 'Concerts', channelIds: ['C'] });
    assert.deepEqual(Object.keys(result), ['Tech', 'Concerts', 'Jeux']);
    assert.deepEqual(result.Concerts, ['C']);
});

test('upsertGroup accepts a group without channel yet, created from the groups page', () => {
    assert.deepEqual(upsertGroup(groups, { name: 'Vide', channelIds: [] }).groups.Vide, []);
});

test('upsertGroup refuses an empty name or a name already taken', () => {
    assert.match(upsertGroup(groups, { name: '   ', channelIds: ['A'] }).error, /nom de groupe/);
    assert.match(upsertGroup(groups, { name: 'Tech', channelIds: ['A'] }).error, /existe déjà/);
    assert.match(upsertGroup(groups, { originalName: 'Jeux', name: 'Tech', channelIds: ['D'] }).error, /existe déjà/);
});

test('upsertGroup treats an unknown original name as a creation', () => {
    const { groups: result } = upsertGroup(groups, { originalName: 'Disparu', name: 'Nouveau', channelIds: ['A'] });
    assert.deepEqual(Object.keys(result), ['Tech', 'Musique', 'Jeux', 'Nouveau']);
});

test('removeGroup deletes only the given group', () => {
    assert.deepEqual(removeGroup(groups, 'Musique'), { Tech: ['A', 'B'], Jeux: ['D'] });
    assert.deepEqual(removeGroup(groups, 'Inconnu'), groups);
});

test('exportGroups writes each group with its channel names', () => {
    const file = exportGroups({ Tech: ['UC1', 'UC2'] }, { UC1: 'Chaîne 1' }, Date.parse('2026-10-01T12:00:00Z'));
    assert.deepEqual(file, {
        format: 'global-video-feed-groups',
        version: 1,
        exportedAt: '2026-10-01T12:00:00.000Z',
        groups: [{ name: 'Tech', channels: [{ id: 'UC1', name: 'Chaîne 1' }, { id: 'UC2', name: '' }] }]
    });
});

test('parseGroupsFile reads an exported file back', () => {
    const file = exportGroups(groups, {}, Date.now());
    assert.deepEqual(parseGroupsFile(file), [
        { name: 'Tech', channelIds: ['A', 'B'] },
        { name: 'Musique', channelIds: ['C'] },
        { name: 'Jeux', channelIds: ['D'] }
    ]);
});

test('parseGroupsFile skips invalid groups and channels, and trims names', () => {
    const file = {
        format: 'global-video-feed-groups',
        version: 1,
        groups: [
            { name: '  Sport  ', channels: [{ id: 'UC1' }, { id: 'UC1' }, { id: 'pas valide !' }, null, { id: 42 }] },
            { name: '', channels: [{ id: 'UC2' }] },
            { name: 'Vide', channels: [] },
            { name: 'Sans liste' },
            { name: 'x'.repeat(80), channels: [{ id: 'UC3' }] }
        ]
    };
    assert.deepEqual(parseGroupsFile(file), [
        { name: 'Sport', channelIds: ['UC1'] },
        { name: 'x'.repeat(60), channelIds: ['UC3'] }
    ]);
});

test('parseGroupsFile rejects files that are not a groups export', () => {
    assert.throws(() => parseGroupsFile(null));
    assert.throws(() => parseGroupsFile([]));
    assert.throws(() => parseGroupsFile({ format: 'autre', groups: [] }));
    assert.throws(() => parseGroupsFile({ format: 'global-video-feed-groups' }));
});

test('mergeGroups adds new groups and completes existing ones without removing anything', () => {
    const { groups: merged, added, completed } = mergeGroups(groups, [
        { name: 'Cuisine', channelIds: ['E'] },
        { name: 'Tech', channelIds: ['B', 'F'] },
        { name: 'Musique', channelIds: ['C'] }
    ]);
    assert.deepEqual(merged, { Tech: ['A', 'B', 'F'], Musique: ['C'], Jeux: ['D'], Cuisine: ['E'] });
    assert.equal(added, 1);
    assert.equal(completed, 1);
    assert.deepEqual(groups.Tech, ['A', 'B'], 'the original groups are not modified');
});

test('renameGroup keeps the channels and the position, and refuses a taken name', () => {
    const { groups: renamed } = renameGroup(groups, 'Musique', 'Sons');
    assert.deepEqual(Object.entries(renamed), [['Tech', ['A', 'B']], ['Sons', ['C']], ['Jeux', ['D']]]);
    assert.match(renameGroup(groups, 'Musique', 'Tech').error, /existe déjà/);
});

test('addToGroup adds channels once, and a channel may be in several groups', () => {
    const result = addToGroup(groups, 'Tech', ['B', 'C', 'C']);
    assert.deepEqual(result.Tech, ['A', 'B', 'C']);
    assert.deepEqual(result.Musique, ['C']);
    assert.deepEqual(groups.Tech, ['A', 'B'], 'the original groups are not modified');
});

test('removeFromGroup removes one channel from one group only', () => {
    const result = removeFromGroup(addToGroup(groups, 'Tech', ['C']), 'Tech', 'C');
    assert.deepEqual(result.Tech, ['A', 'B']);
    assert.deepEqual(result.Musique, ['C']);
    assert.equal(removeFromGroup(groups, 'Inconnu', 'A'), groups);
});

test('groupsOfChannel and ungroupedChannels', () => {
    const multi = addToGroup(groups, 'Jeux', ['C']);
    assert.deepEqual(groupsOfChannel(multi, 'C'), ['Musique', 'Jeux']);
    assert.deepEqual(groupsOfChannel(multi, 'Z'), []);
    assert.deepEqual(ungroupedChannels(groups, ['A', 'C', 'X', 'Y']), ['X', 'Y']);
});

test('channelActivity and groupActivity read the latest video and the unwatched count from the cache', () => {
    const cache = {
        A: [{ videoId: 'a1', publishedAt: '2026-09-01T00:00:00Z' }, { videoId: 'a2', publishedAt: '2026-09-20T00:00:00Z' }],
        B: [{ videoId: 'b1', publishedAt: '2026-05-01T00:00:00Z' }]
    };
    const history = { a2: { watchedAt: 1 } };
    assert.deepEqual(channelActivity('A', cache, history), { lastUpload: '2026-09-20T00:00:00Z', unwatched: 1 });
    assert.deepEqual(channelActivity('Z', cache, history), { lastUpload: null, unwatched: 0 });
    assert.deepEqual(groupActivity(['A', 'B', 'Z'], cache, history), { lastUpload: '2026-09-20T00:00:00Z', unwatched: 2 });
    assert.deepEqual(groupActivity([], cache, history), { lastUpload: null, unwatched: 0 });
});
