import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_VIDEOS_PER_CHANNEL } from '../js/config.js';
import {
    buildFeed, getRelativeTime, isValidYouTubeId, keepChannels, longFormPlaylistId, mergeChannelVideos,
    toCachedVideo
} from '../js/feed.js';

// playlistItems API item, as returned by the YouTube Data API
function apiItem(videoId, extra = {}) {
    return {
        snippet: {
            title: `Titre ${videoId}`,
            description: 'longue description',
            channelTitle: 'Chaîne',
            publishedAt: '2026-01-01T10:00:00Z',
            resourceId: { kind: 'youtube#video', videoId },
            thumbnails: { default: { url: 'd.jpg' }, medium: { url: 'm.jpg' }, high: { url: 'h.jpg' } },
            ...extra
        }
    };
}

function cached(videoId, publishedAt = '2026-01-01T00:00:00Z') {
    return { videoId, title: `Titre ${videoId}`, channelTitle: 'Chaîne', publishedAt, thumbnail: '' };
}

test('isValidYouTubeId accepts IDs and rejects anything else', () => {
    assert.equal(isValidYouTubeId('dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeId('a_b-C1'), true);
    assert.equal(isValidYouTubeId(''), false);
    assert.equal(isValidYouTubeId(undefined), false);
    assert.equal(isValidYouTubeId('abc"><script>'), false);
    assert.equal(isValidYouTubeId('abc/def'), false);
});

test('longFormPlaylistId swaps the uploads prefix for the long-form one', () => {
    assert.equal(longFormPlaylistId('UU_x5XG1OV2P6uZZ5FSM9Ttw'), 'UULF_x5XG1OV2P6uZZ5FSM9Ttw');
    assert.equal(longFormPlaylistId('PLsomething'), 'PLsomething');
});

test('toCachedVideo keeps only the fields the feed needs', () => {
    assert.deepEqual(toCachedVideo(apiItem('v1')), {
        videoId: 'v1',
        title: 'Titre v1',
        channelTitle: 'Chaîne',
        publishedAt: '2026-01-01T10:00:00Z',
        thumbnail: 'h.jpg'
    });
});

test('toCachedVideo falls back to smaller thumbnails, then to an empty string', () => {
    assert.equal(toCachedVideo(apiItem('v1', { thumbnails: { medium: { url: 'm.jpg' } } })).thumbnail, 'm.jpg');
    assert.equal(toCachedVideo(apiItem('v1', { thumbnails: { default: { url: 'd.jpg' } } })).thumbnail, 'd.jpg');
    assert.equal(toCachedVideo(apiItem('v1', { thumbnails: undefined })).thumbnail, '');
    assert.equal(toCachedVideo({}).videoId, undefined);
});

test('mergeChannelVideos puts fetched videos first and keeps older ones', () => {
    const merged = mergeChannelVideos([apiItem('new1'), apiItem('new2')], [cached('old1'), cached('old2')]);
    assert.deepEqual(merged.map(v => v.videoId), ['new1', 'new2', 'old1', 'old2']);
});

test('mergeChannelVideos prefers the fetched version of a video already cached', () => {
    const merged = mergeChannelVideos([apiItem('v1', { title: 'Nouveau titre' })], [cached('v1'), cached('v2')]);
    assert.deepEqual(merged.map(v => v.videoId), ['v1', 'v2']);
    assert.equal(merged[0].title, 'Nouveau titre');
});

test('mergeChannelVideos caps the list and ignores items without video ID', () => {
    const items = [apiItem('a'), { snippet: { title: 'sans ID' } }];
    const older = Array.from({ length: 20 }, (_, i) => cached(`old${i}`));
    const merged = mergeChannelVideos(items, older);
    assert.equal(merged.length, MAX_VIDEOS_PER_CHANNEL);
    assert.equal(merged[0].videoId, 'a');
    assert.ok(merged.every(v => v.videoId));
});

test('mergeChannelVideos works without cached videos', () => {
    assert.deepEqual(mergeChannelVideos([apiItem('v1')]).map(v => v.videoId), ['v1']);
});

test('keepChannels only keeps the given channels', () => {
    assert.deepEqual(keepChannels({ A: 1, B: 2, C: 3 }, ['A', 'C', 'D']), { A: 1, C: 3 });
    assert.deepEqual(keepChannels({ A: 1 }, []), {});
});

test('buildFeed flattens all channels, newest first, with the channel ID', () => {
    const feed = buildFeed({
        A: [cached('a1', '2026-01-03T00:00:00Z'), cached('a2', '2026-01-01T00:00:00Z')],
        B: [cached('b1', '2026-01-02T00:00:00Z')]
    });
    assert.deepEqual(feed.map(v => v.videoId), ['a1', 'b1', 'a2']);
    assert.deepEqual(feed.map(v => v.channelId), ['A', 'B', 'A']);
});

test('buildFeed can be limited to some channels', () => {
    const cache = { A: [cached('a1')], B: [cached('b1')], C: [cached('c1')] };
    assert.deepEqual(buildFeed(cache, ['A', 'C']).map(v => v.videoId).sort(), ['a1', 'c1']);
    assert.deepEqual(buildFeed(cache, []), []);
});

test('buildFeed puts videos without date last', () => {
    const feed = buildFeed({ A: [cached('nodate', null), cached('dated', '2026-01-01T00:00:00Z')] });
    assert.deepEqual(feed.map(v => v.videoId), ['dated', 'nodate']);
});

test('getRelativeTime formats each unit in French', () => {
    const now = Date.parse('2026-06-15T12:00:00Z');
    const ago = ms => new Date(now - ms).toISOString();
    const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

    assert.equal(getRelativeTime(ago(10 * 1000), now), 'à l\'instant');
    assert.equal(getRelativeTime(ago(5 * MIN), now), 'il y a 5min');
    assert.equal(getRelativeTime(ago(3 * HOUR), now), 'il y a 3h');
    assert.equal(getRelativeTime(ago(1 * DAY), now), 'il y a 1 jour');
    assert.equal(getRelativeTime(ago(2 * DAY), now), 'il y a 2 jours');
    assert.equal(getRelativeTime(ago(45 * DAY), now), 'il y a 1 mois');
    assert.equal(getRelativeTime(ago(400 * DAY), now), 'il y a 1 an');
    assert.equal(getRelativeTime(ago(800 * DAY), now), 'il y a 2 ans');
});

test('getRelativeTime handles missing and invalid dates', () => {
    assert.equal(getRelativeTime(undefined), 'Date inconnue');
    assert.equal(getRelativeTime('pas une date'), 'Date invalide');
});
