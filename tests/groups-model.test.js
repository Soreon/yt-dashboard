import { test } from 'node:test';
import assert from 'node:assert/strict';

import { removeGroup, upsertGroup } from '../js/groups-model.js';

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
