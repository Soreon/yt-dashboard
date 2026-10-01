import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_HISTORY } from '../js/config.js';
import { dayLabel, groupByDay, historyEntries, markWatched, unmarkWatched } from '../js/history-model.js';

function video(videoId, extra = {}) {
    return { videoId, title: `Titre ${videoId}`, channelTitle: 'Chaîne', channelId: 'UC1', publishedAt: '2026-01-01T00:00:00Z', thumbnail: 't.jpg', duration: 60, views: 10, ...extra };
}

// Local dates, so day boundaries do not depend on the time zone running the tests
const at = (day, hour = 12) => new Date(2026, 8, day, hour).getTime(); // September 2026

test('markWatched stores a snapshot of the video with the time', () => {
    const history = markWatched({}, video('v1', { channelId: 'UC9', extra: 'ignoré' }), 1000);
    assert.deepEqual(history.v1, { watchedAt: 1000, video: video('v1', { channelId: 'UC9' }) });
});

test('markWatched updates the time of a video already watched', () => {
    const history = markWatched(markWatched({}, video('v1'), 1000), video('v1'), 5000);
    assert.equal(history.v1.watchedAt, 5000);
    assert.equal(Object.keys(history).length, 1);
});

test('markWatched keeps only the most recent entries', () => {
    let history = {};
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
        history = markWatched(history, video(`v${i}`), i);
    }
    assert.equal(Object.keys(history).length, MAX_HISTORY);
    assert.equal(history.v0, undefined);
    assert.ok(history[`v${MAX_HISTORY + 4}`]);
});

test('unmarkWatched removes only the given video, without changing the original', () => {
    const history = markWatched(markWatched({}, video('v1'), 1), video('v2'), 2);
    const result = unmarkWatched(history, 'v1');
    assert.deepEqual(Object.keys(result), ['v2']);
    assert.ok(history.v1);
});

test('historyEntries sorts by watch time, most recent first', () => {
    const history = { a: { watchedAt: 1, video: video('a') }, b: { watchedAt: 3, video: video('b') }, c: { watchedAt: 2, video: video('c') } };
    assert.deepEqual(historyEntries(history).map(entry => entry.video.videoId), ['b', 'c', 'a']);
});

test('dayLabel names days like the YouTube history', () => {
    const now = at(30, 9); // Wednesday 30 September 2026
    assert.equal(dayLabel(at(30, 1), now), 'Aujourd\'hui');
    assert.equal(dayLabel(at(29, 23), now), 'Hier');
    assert.equal(dayLabel(at(28), now), 'lundi');
    assert.equal(dayLabel(at(24), now), 'jeudi');
    assert.equal(dayLabel(at(10), now), '10 septembre');
    assert.equal(dayLabel(new Date(2025, 11, 25).getTime(), now), '25 décembre 2025');
});

test('groupByDay groups consecutive entries of the same day', () => {
    const now = at(30, 20);
    const entries = [at(30, 18), at(30, 8), at(29), at(20)].map((watchedAt, i) => ({ watchedAt, video: video(`v${i}`) }));
    const groups = groupByDay(entries, now);
    assert.deepEqual(groups.map(g => [g.label, g.entries.length]), [['Aujourd\'hui', 2], ['Hier', 1], ['20 septembre', 1]]);
});
