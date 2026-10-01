import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../js/ui.js';

test('escapeHtml escapes markup', () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
});

test('escapeHtml escapes quotes, so values are safe inside attributes', () => {
    assert.equal(escapeHtml('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)');
    assert.equal(escapeHtml('L\'été'), 'L&#39;été');
});

test('escapeHtml handles missing values', () => {
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(42), '42');
});
