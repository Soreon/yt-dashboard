import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listZipEntries, readZipText } from '../js/zip.js';
import { buildZip } from './zip-builder.js';

const toArrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const files = {
    'Takeout/archive_browser.html': '<html></html>',
    'Takeout/YouTube et YouTube Music/historique/watch-history.json': JSON.stringify([{ title: 'Vous avez regardé Été 🎬' }])
};

test('listZipEntries reads the central directory, with UTF-8 names', () => {
    const entries = listZipEntries(toArrayBuffer(buildZip(files)));
    assert.deepEqual(entries.map(entry => entry.name), Object.keys(files));
    assert.equal(entries[1].method, 8);
    assert.equal(entries[1].size, Buffer.byteLength(files['Takeout/YouTube et YouTube Music/historique/watch-history.json']));
});

test('readZipText inflates a deflated entry', async () => {
    const text = await readZipText(toArrayBuffer(buildZip(files)), name => name.endsWith('watch-history.json'));
    assert.deepEqual(JSON.parse(text), [{ title: 'Vous avez regardé Été 🎬' }]);
});

test('readZipText reads a stored entry, and an archive with a comment', async () => {
    const buffer = toArrayBuffer(buildZip(files, { stored: true, comment: 'made by a test' }));
    const text = await readZipText(buffer, name => name.endsWith('.html'));
    assert.equal(text, '<html></html>');
});

test('readZipText returns null when no entry matches, and rejects non-zip data', async () => {
    assert.equal(await readZipText(toArrayBuffer(buildZip(files)), name => name.endsWith('.csv')), null);
    await assert.rejects(readZipText(toArrayBuffer(Buffer.from('not a zip at all, really not')), () => true), /Not a zip/);
});
