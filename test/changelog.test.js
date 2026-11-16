// The Changelog view's copy of CHANGELOG.md (run `npm run changelog` when this fails).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CHANGELOG } from '../src/ui/changelog.js';

test('the add-on\'s changelog matches CHANGELOG.md', () => {
	assert.equal(CHANGELOG, readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
});
