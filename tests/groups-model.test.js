import { test } from 'node:test';
import assert from 'node:assert/strict';

import { exportGroups, mergeGroups, parseGroupsFile, removeGroup, upsertGroup } from '../js/groups-model.js';

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

test('upsertGroup refuses an empty name, no channel, or a name already taken', () => {
    assert.match(upsertGroup(groups, { name: '   ', channelIds: ['A'] }).error, /nom de groupe/);
    assert.match(upsertGroup(groups, { name: 'Vide', channelIds: [] }).error, /au moins une chaîne/);
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
