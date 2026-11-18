// Base XP: a play's XP with the bonuses taken back out (run with `npm test`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseXp, modXp, multiplierAt, noteMultipliers, recentOfMap } from '../src/rules/base.js';

const skills = (total) => ({ speed: { xp_multipliers: { total: String(total) } }, accuracy: { xp_multipliers: { total: String(total) } } });

test('multipliers are noted from when they were seen, not before', () => {
	const h = {};
	assert.equal(noteMultipliers(h, skills(2), 1000), true);
	assert.equal(noteMultipliers(h, skills(2), 2000), false);
	noteMultipliers(h, skills(3), 5000);
	assert.equal(multiplierAt(h, 'speed', 500), 0);
	assert.equal(multiplierAt(h, 'speed', 1500), 2);
	assert.equal(multiplierAt(h, 'speed', 6000), 3);
});

test('a play\'s XP divided by its multiplier, mods and mindblock', () => {
	const h = {};
	noteMultipliers(h, skills(2), 0);
	const play = { playedAt: 10, mods: '', gains: { speed: 1000, accuracy: 300 }, total: 1300, acc: 0.97 };
	assert.deepEqual(baseXp(play, { history: h, recent: 0, bar: 0.5 }), { base: { speed: 500, accuracy: 150 } });
	// Hard Rock: accuracy 10% more; Easy: half
	assert.equal(modXp('HR', 'accuracy'), 1.1);
	assert.equal(modXp('EZ', 'speed'), 0.5);
	assert.deepEqual(baseXp({ ...play, mods: 'EZ' }, { history: h, recent: 0, bar: 0.5 }), { base: { speed: 1000, accuracy: 300 } });
});

test('plays that can\'t be taken back exactly aren\'t used', () => {
	const h = {};
	noteMultipliers(h, skills(2), 100);
	const play = { playedAt: 200, mods: '', gains: { speed: 1000 }, total: 1000, acc: 0.97 };
	assert.equal(baseXp(play, { history: h, recent: 0, bar: 0.85 }).skip, 'fatigued');
	assert.equal(baseXp(play, { history: h, recent: 0 }).skip, 'strain not noted');
	assert.equal(baseXp({ ...play, mods: 'NF' }, { history: h, recent: 0, bar: 0.5 }).skip, 'No Fail');
	assert.equal(baseXp({ ...play, acc: 1 }, { history: h, recent: 0, bar: 0.5 }).skip.startsWith('100%'), true);
	assert.equal(baseXp({ ...play, playedAt: 50 }, { history: h, recent: 0, bar: 0.5 }).skip, 'multiplier not noted yet');
	assert.equal(baseXp({ ...play, gains: { accuracy: 100 }, total: 100 }, { history: h, recent: 20, bar: 0.5 }).skip, 'mindblock');
});

test('mindblock counts the map in the last 50 plays within a day', () => {
	const day = 864e5, plays = [{ beatmapId: 1, playedAt: 3 * day }, { beatmapId: 2, playedAt: 3 * day - 1 }, { beatmapId: 1, playedAt: 3 * day - 2 }, { beatmapId: 1, playedAt: day }];
	assert.equal(recentOfMap(plays, 0), 1);
});
