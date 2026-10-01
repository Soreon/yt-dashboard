import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_HISTORY } from '../js/config.js';
import {
    dayLabel, groupByDay, historyEntries, importWatches, markWatched, parseTakeoutHistory, unmarkWatched, watchedLookup
} from '../js/history-model.js';

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

// Records as found in a Google Takeout watch-history.json (French account)
const takeout = [
    {
        header: 'YouTube',
        title: 'Vous avez regardé Les échecs pour débutants',
        titleUrl: 'https://www.youtube.com/watch?v\u003dabcdefghijk',
        subtitles: [{ name: 'Chaîne Stratégie', url: 'https://www.youtube.com/channel/UCstrategie123' }],
        time: '2026-09-30T18:22:11.123Z',
        products: ['YouTube'],
        activityControls: ['Historique des vidéos regardées sur YouTube']
    },
    {
        header: 'YouTube',
        title: 'Vous avez regardé Les échecs pour débutants',
        titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        subtitles: [{ name: 'Chaîne Stratégie', url: 'https://www.youtube.com/channel/UCstrategie123' }],
        time: '2026-09-01T08:00:00Z',
        products: ['YouTube']
    },
    {
        header: 'YouTube',
        title: 'Watched Cooking 101',
        titleUrl: 'https://www.youtube.com/watch?v=cooking1234',
        subtitles: [{ name: 'Chef', url: 'https://www.youtube.com/@chef' }],
        time: '2026-09-29T12:00:00Z',
        products: ['YouTube']
    },
    { header: 'YouTube', title: 'Vous avez regardé une vidéo qui a été supprimée', time: '2026-09-28T12:00:00Z', products: ['YouTube'] },
    { header: 'YouTube', title: 'Vous avez regardé Annonce', titleUrl: 'https://www.youtube.com/watch?v=adadadadada', time: '2026-09-28T12:00:00Z', details: [{ name: 'Annonces Google' }] },
    { header: 'YouTube', title: 'Vous avez consulté une page', titleUrl: 'https://www.youtube.com/channel/UCxyz', time: '2026-09-28T12:00:00Z' }
];

test('parseTakeoutHistory keeps one entry per video, with its latest watch', () => {
    const watches = parseTakeoutHistory(takeout);
    assert.deepEqual(watches, [
        { videoId: 'abcdefghijk', title: 'Les échecs pour débutants', channelTitle: 'Chaîne Stratégie', channelId: 'UCstrategie123', watchedAt: Date.parse('2026-09-30T18:22:11.123Z') },
        { videoId: 'cooking1234', title: 'Cooking 101', channelTitle: 'Chef', channelId: null, watchedAt: Date.parse('2026-09-29T12:00:00Z') }
    ]);
});

test('parseTakeoutHistory rejects files that are not a watch history', () => {
    assert.throws(() => parseTakeoutHistory({ foo: 'bar' }));
    assert.throws(() => parseTakeoutHistory(null));
    assert.deepEqual(parseTakeoutHistory([]), []);
});

test('importWatches adds new videos, with feed details when the video is in the cache', () => {
    const watches = parseTakeoutHistory(takeout);
    const cache = { UCstrategie123: [video('abcdefghijk', { title: 'Titre du fil', channelId: undefined, duration: 600 })] };
    const { history, added } = importWatches({}, watches, cache);

    assert.equal(added, 2);
    assert.equal(history.abcdefghijk.video.title, 'Titre du fil');
    assert.equal(history.abcdefghijk.video.duration, 600);
    assert.equal(history.abcdefghijk.video.channelId, 'UCstrategie123');
    assert.equal(history.cooking1234.video.thumbnail, 'https://i.ytimg.com/vi/cooking1234/mqdefault.jpg');
    assert.equal(history.cooking1234.watchedAt, Date.parse('2026-09-29T12:00:00Z'));
});

test('importWatches keeps the most recent watch of a video already in the history', () => {
    const watches = parseTakeoutHistory(takeout);
    const later = Date.parse('2026-10-01T00:00:00Z');
    const history = markWatched({}, video('abcdefghijk'), later);
    const result = importWatches(history, watches);

    assert.equal(result.added, 1);
    assert.equal(result.history.abcdefghijk.watchedAt, later);

    const older = markWatched({}, video('cooking1234', { title: 'Local' }), Date.parse('2026-01-01T00:00:00Z'));
    const updated = importWatches(older, watches).history.cooking1234;
    assert.equal(updated.watchedAt, Date.parse('2026-09-29T12:00:00Z'));
    assert.equal(updated.video.title, 'Local', 'known details are kept');
});

test('watchedLookup answers for the detailed history and the full ID list', () => {
    const lookup = watchedLookup(markWatched({}, video('v1'), 1), ['v1', 'old9']);
    assert.ok(lookup.v1 && lookup.old9);
    assert.equal(lookup.other, undefined);
    assert.equal(lookup.v1.watchedAt, 1, 'history entries keep their details');
});
