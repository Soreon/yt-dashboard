import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATCH_UP_VIDEOS, MAX_KEPT_PER_CHANNEL, MAX_VIDEOS_PER_CHANNEL, VIDEOS_PER_SYNC } from '../js/config.js';
import {
    applyVideoDetails, buildFeed, channelsDue, channelSyncInterval, formatDuration, formatViews, getRelativeTime, isValidYouTubeId, keepChannels,
    longFormPlaylistId, matchesSearch, mergeChannelVideos, nextQuotaReset, normalizeText, parseIsoDuration,
    quotaResetText, toCachedVideo, videosMissingDetails, videosToFetch
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

test('mergeChannelVideos keeps the unwatched videos of the last weeks beyond the cap, up to a limit', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    const day = 24 * 3600 * 1000;
    const older = Array.from({ length: 40 }, (_, i) => cached(`old${i}`, new Date(now - (i + 1) * day / 2).toISOString()));
    const watched = new Set(['old12', 'old13']);

    const merged = mergeChannelVideos([apiItem('a')], older, { isWatched: id => watched.has(id), now });
    const ids = merged.map(v => v.videoId);
    assert.deepEqual(ids.slice(0, MAX_VIDEOS_PER_CHANNEL), ['a', ...older.slice(0, MAX_VIDEOS_PER_CHANNEL - 1).map(v => v.videoId)]);
    assert.ok(!ids.includes('old12') && !ids.includes('old13'), 'watched ones go');
    assert.equal(ids.length, MAX_KEPT_PER_CHANNEL);

    // Older than 30 days: not kept, even unwatched
    const old = Array.from({ length: 15 }, (_, i) => cached(`old${i}`, new Date(now - (40 + i) * day).toISOString()));
    assert.equal(mergeChannelVideos([], old, { isWatched: () => false, now }).length, MAX_VIDEOS_PER_CHANNEL);
});

test('videosToFetch asks for more videos when the channel was read long ago', () => {
    const now = Date.UTC(2026, 9, 2);
    assert.equal(videosToFetch(undefined, now), VIDEOS_PER_SYNC, 'never read: the usual number');
    assert.equal(videosToFetch(now - 3600 * 1000, now), VIDEOS_PER_SYNC);
    assert.equal(videosToFetch(now - 2 * 24 * 3600 * 1000, now), CATCH_UP_VIDEOS);
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

test('getRelativeTime words each unit like YouTube', () => {
    const now = Date.parse('2026-06-15T12:00:00Z');
    const ago = ms => new Date(now - ms).toISOString();
    const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

    assert.equal(getRelativeTime(ago(0), now), 'il y a 1 seconde');
    assert.equal(getRelativeTime(ago(10 * SEC), now), 'il y a 10 secondes');
    assert.equal(getRelativeTime(ago(1 * MIN), now), 'il y a 1 minute');
    assert.equal(getRelativeTime(ago(5 * MIN), now), 'il y a 5 minutes');
    assert.equal(getRelativeTime(ago(3 * HOUR), now), 'il y a 3 heures');
    assert.equal(getRelativeTime(ago(1 * DAY), now), 'il y a 1 jour');
    assert.equal(getRelativeTime(ago(6 * DAY), now), 'il y a 6 jours');
    assert.equal(getRelativeTime(ago(7 * DAY), now), 'il y a 1 semaine');
    assert.equal(getRelativeTime(ago(20 * DAY), now), 'il y a 2 semaines');
    assert.equal(getRelativeTime(ago(45 * DAY), now), 'il y a 1 mois');
    assert.equal(getRelativeTime(ago(200 * DAY), now), 'il y a 6 mois');
    assert.equal(getRelativeTime(ago(400 * DAY), now), 'il y a 1 an');
    assert.equal(getRelativeTime(ago(800 * DAY), now), 'il y a 2 ans');
    assert.equal(getRelativeTime(new Date(now + HOUR).toISOString(), now), 'Prochainement');
});

test('getRelativeTime handles missing and invalid dates', () => {
    assert.equal(getRelativeTime(undefined), 'Date inconnue');
    assert.equal(getRelativeTime('pas une date'), 'Date invalide');
});

test('mergeChannelVideos keeps the details already known for a video', () => {
    const merged = mergeChannelVideos([apiItem('v1')], [{ ...cached('v1'), duration: 600, views: 42 }]);
    assert.equal(merged[0].duration, 600);
    assert.equal(merged[0].views, 42);
});

test('videosMissingDetails lists videos never detailed', () => {
    const cache = { A: [{ ...cached('a1'), duration: 60, views: 1 }, cached('a2')], B: [{ ...cached('b1'), duration: null, views: null }] };
    assert.deepEqual(videosMissingDetails(cache), ['a2']);
});

test('applyVideoDetails merges details without touching other videos', () => {
    const cache = { A: [cached('a1'), cached('a2')] };
    const updated = applyVideoDetails(cache, { a1: { duration: 90, views: 1000 } });
    assert.equal(updated.A[0].duration, 90);
    assert.equal(updated.A[0].views, 1000);
    assert.equal(updated.A[1].duration, undefined);
    assert.equal(cache.A[0].duration, undefined, 'the original cache is not modified');
});

test('parseIsoDuration converts API durations to seconds', () => {
    assert.equal(parseIsoDuration('PT45S'), 45);
    assert.equal(parseIsoDuration('PT12M5S'), 725);
    assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
    assert.equal(parseIsoDuration('PT2H'), 7200);
    assert.equal(parseIsoDuration('P1DT2H'), 93600);
    assert.equal(parseIsoDuration('P0D'), 0);
    assert.equal(parseIsoDuration('n/a'), null);
    assert.equal(parseIsoDuration(undefined), null);
});

test('formatDuration matches the YouTube badge', () => {
    assert.equal(formatDuration(45), '0:45');
    assert.equal(formatDuration(725), '12:05');
    assert.equal(formatDuration(3723), '1:02:03');
    assert.equal(formatDuration(0), '');
    assert.equal(formatDuration(null), '');
});

test('formatViews matches YouTube in French', () => {
    assert.equal(formatViews(0), 'Aucune vue');
    assert.equal(formatViews(1), '1 vue');
    assert.equal(formatViews(345), '345 vues');
    assert.equal(formatViews(1000), '1 k vues');
    assert.equal(formatViews(1290), '1,2 k vues');
    assert.equal(formatViews(12900), '12 k vues');
    assert.equal(formatViews(999999), '999 k vues');
    assert.equal(formatViews(3456789), '3,4 M de vues');
    assert.equal(formatViews(25000000), '25 M de vues');
    assert.equal(formatViews(1500000000), '1,5 Md de vues');
    assert.equal(formatViews(null), '');
});

test('normalizeText lowercases and strips accents', () => {
    assert.equal(normalizeText('Électro ÇA Va'), 'electro ca va');
    assert.equal(normalizeText(undefined), '');
});

test('matchesSearch needs every word in the title or channel name', () => {
    const video = { title: 'Les Échecs pour débutants', channelTitle: 'Chaîne Stratégie' };
    assert.equal(matchesSearch(video, ''), true);
    assert.equal(matchesSearch(video, 'echecs'), true);
    assert.equal(matchesSearch(video, 'ÉCHECS chaine'), true);
    assert.equal(matchesSearch(video, 'echecs cuisine'), false);
});

test('nextQuotaReset is the next midnight, Pacific time, summer and winter', () => {
    assert.equal(nextQuotaReset(Date.UTC(2026, 9, 2, 12, 0)), Date.UTC(2026, 9, 3, 7, 0)); // 05:00 PDT
    assert.equal(nextQuotaReset(Date.UTC(2026, 9, 3, 6, 59, 30)), Date.UTC(2026, 9, 3, 7, 0)); // 23:59 PDT
    assert.equal(nextQuotaReset(Date.UTC(2026, 9, 3, 7, 0)), Date.UTC(2026, 9, 4, 7, 0)); // Midnight: the next one
    assert.equal(nextQuotaReset(Date.UTC(2026, 0, 15, 12, 0)), Date.UTC(2026, 0, 16, 8, 0)); // 04:00 PST
});

test('quotaResetText gives the time, and says tomorrow when it is', () => {
    const reset = new Date(2026, 9, 3, 9, 0).getTime();
    assert.equal(quotaResetText(reset, new Date(2026, 9, 3, 2, 0).getTime()), 'à partir de 09:00');
    assert.equal(quotaResetText(reset, new Date(2026, 9, 2, 22, 0).getTime()), 'demain à partir de 09:00');
});

test('channelSyncInterval reads often the channels that publish often', () => {
    const now = Date.UTC(2026, 9, 2);
    const day = 24 * 3600 * 1000;
    const videos = (...ages) => ages.map(age => ({ publishedAt: new Date(now - age * day).toISOString() }));

    assert.equal(channelSyncInterval(undefined, now), 0, 'never read');
    assert.equal(channelSyncInterval([], now), 0);
    assert.equal(channelSyncInterval(videos(300, 3), now), 0, 'the latest video counts');
    assert.equal(channelSyncInterval(videos(20), now), 6 * 3600 * 1000);
    assert.equal(channelSyncInterval(videos(200), now), day);
    assert.equal(channelSyncInterval(videos(400), now), 7 * day);
    assert.equal(channelSyncInterval([{ publishedAt: 'pas une date' }], now), 0);
});

test('channelsDue keeps the channels whose wait is over', () => {
    const now = Date.UTC(2026, 9, 2);
    const day = 24 * 3600 * 1000;
    const cache = {
        UC_ACTIVE: [{ publishedAt: new Date(now - day).toISOString() }],
        UC_SLOW: [{ publishedAt: new Date(now - 200 * day).toISOString() }],
        UC_OLD: [{ publishedAt: new Date(now - 400 * day).toISOString() }]
    };
    const fetchedAt = { UC_ACTIVE: now - 60 * 1000, UC_SLOW: now - 2 * day, UC_OLD: now - 3 * day };

    assert.deepEqual(channelsDue(['UC_ACTIVE', 'UC_SLOW', 'UC_OLD', 'UC_NEW'], cache, fetchedAt, now), ['UC_ACTIVE', 'UC_SLOW', 'UC_NEW']);
});
