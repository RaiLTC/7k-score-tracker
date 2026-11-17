// Outdated plays: a skill's level or prestige moved on since the play (run with `npm test`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteLevels, outdatedFor } from '../src/rules/outdated.js';

const both = { level: true, prestige: true };

test('plays from before the first note count as current', () => {
	const h = {};
	assert.equal(noteLevels(h, { speed: { level: 97, prestige: 0 } }, 5000), true);
	assert.equal(outdatedFor(h, 'speed', 1000, both), '');
	assert.equal(outdatedFor(h, 'speed', 6000, both), '');
	// nothing changed: nothing noted
	assert.equal(noteLevels(h, { speed: { level: 97, prestige: 0 } }, 7000), false);
});

test('a level up outdates the plays before it, not the play that made it', () => {
	const h = {};
	noteLevels(h, { speed: { level: 97, prestige: 0 } }, 1000);
	noteLevels(h, { speed: { level: 98, prestige: 0 } }, 5000);
	assert.equal(outdatedFor(h, 'speed', 4000, both), 'level');
	assert.equal(outdatedFor(h, 'speed', 5000, both), '');
	assert.equal(outdatedFor(h, 'speed', 4000, { level: false, prestige: true }), '');
	// another skill isn't touched
	assert.equal(outdatedFor(h, 'jacks', 4000, both), '');
});

test('a prestige outdates the plays before it, with either setting', () => {
	const h = {};
	noteLevels(h, { jacks: { level: 100, prestige: 0 } }, 1000);
	noteLevels(h, { jacks: { level: 101, prestige: 1 } }, 5000);
	assert.equal(outdatedFor(h, 'jacks', 4000, both), 'prestige');
	assert.equal(outdatedFor(h, 'jacks', 4000, { level: true, prestige: false }), 'level');
	assert.equal(outdatedFor(h, 'jacks', 4000, { level: false, prestige: false }), '');
});
