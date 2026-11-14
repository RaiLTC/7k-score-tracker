// The tracker's rules (run with `npm test`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agoText, bestMaps, is7kPlay, parseGains, totalOf, xpText } from '../src/logic.js';

const play = (beatmapId, gains, info, rate = 1) => ({ beatmapId, playedAt: 0, rate, mods: '', gains, info, total: totalOf(gains) });
const map = (keys, lengthSec) => ({ title: 'Song', difficulty: 'Hard', keys, lengthSec });

test('a play is 7K by its map\'s keys, or by 7K-only skills when the map is unknown', () => {
	assert.equal(is7kPlay(map(7, 120), { speed: 100 }), true);
	assert.equal(is7kPlay(map(4, 120), { jacks: 100 }), false);
	assert.equal(is7kPlay(undefined, { ln: 10 }), true);
	assert.equal(is7kPlay(undefined, { speed: 10 }), false);
});

test('gains are read safely from the game\'s JSON', () => {
	assert.deepEqual(parseGains('{"speed":5}'), { speed: 5 });
	assert.deepEqual(parseGains('not json'), {});
	assert.deepEqual(parseGains(null), {});
	assert.equal(totalOf({ speed: 5, jacks: 3, notASkill: 100 }), 8);
});

test('maps are ranked by XP per minute at the rate played, each rate on its own', () => {
	const best = bestMaps([
		play(1, { speed: 600 }, map(7, 120)),        // 600 XP in 2 min: 300 a minute
		play(1, { speed: 400 }, map(7, 120)),        // the same map again: averages to 250 a minute
		play(2, { speed: 300 }, map(7, 60)),         // 300 a minute
		play(2, { speed: 330 }, map(7, 60), 1.1),    // faster: 60 s / 1.1, so 363 a minute
		play(3, { speed: 999 }, undefined),          // no length: after the rest
		play(4, {}, map(7, 60)),                     // no XP: left out
	]);
	assert.deepEqual(best.map((m) => `${m.beatmapId}@${m.rate}`), ['2@1.1', '2@1', '1@1', '3@1']);
	assert.equal(best.find((m) => m.beatmapId === 1).n, 2);
	assert.equal(Math.round(best.find((m) => m.beatmapId === 1).perMinute), 250);
	assert.equal(best.at(-1).perMinute, 0);
});

test('numbers and times read as players expect', () => {
	assert.equal(xpText(18400), '18.4K');
	assert.equal(xpText(2_500_000), '2.50M');
	assert.equal(agoText(30_000), 'just now');
	assert.equal(agoText(3 * 3600e3), '3h ago');
});

test('a play saved without XP is counted, but never the latest play or part of an average', () => {
	const at = (p, t) => ({ ...p, playedAt: t });
	const [m] = bestMaps([
		at(play(1, {}, map(7, 60)), 3),               // newest, no XP yet
		at(play(1, { speed: 200 }, map(7, 60)), 2),
		at(play(1, { speed: 100 }, map(7, 60)), 1),
	]);
	assert.equal(m.n, 3);
	assert.equal(m.lastXp, 200);
	assert.equal(m.perPlay, 150);
	assert.equal(m.prevXp, 100);
});
