// The tracker's rules (run with `npm test`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agoText, allTimeBest, bestBySkill, bestMaps, dayOf, is7kPlay, parseGains, parseSearch, playedIn, searching, timeOf, totalOf, xpText } from '../src/rules/logic.js';
import { arrowsOf, restedStrain, strainPerMinute, strainWhenSet } from '../src/rules/strain.js';

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

test('a play whose XP isn\'t written yet is counted, but never the latest play or part of an average', () => {
	const at = (p, t) => ({ ...p, playedAt: t });
	const plays = [
		at(play(1, {}, map(7, 60)), 3),               // newest, no XP yet
		at(play(1, { speed: 200 }, map(7, 60)), 2),
		at(play(1, { speed: 100 }, map(7, 60)), 1),
	];
	const [m] = bestMaps(plays, Infinity, 10);
	assert.equal(m.n, 3);
	assert.equal(m.lastXp, 200);
	assert.equal(m.perPlay, 150);
	assert.equal(m.prevXp, 100);
	// a minute on, it gave 0: the latest play, and with only it counted the map drops out
	assert.equal(bestMaps(plays, Infinity, 3 + 60e3)[0].lastXp, 0);
	assert.equal(bestMaps(plays, 1, 3 + 60e3).length, 0);
	// the game saved its XP as 0: counted at once
	assert.equal(bestMaps([{ ...plays[0], xpSaved: true }, plays[1]], 1, 10).length, 0);
});

test('averages use only the latest plays when limited', () => {
	const info = { title: 'A', difficulty: 'B', keys: 7, lengthSec: 60 };
	const play = (playedAt, total) => ({ beatmapId: 1, playedAt, rate: 1, mods: '', gains: { speed: total }, info, total });
	const plays = [play(3, 1100), play(2, 3700), play(1, 4000)];
	assert.equal(bestMaps(plays)[0].perPlay, 2933.3333333333335);
	const [m] = bestMaps(plays, 1);
	assert.equal(m.perPlay, 1100);
	assert.equal(m.n, 3);
	assert.equal(m.lastXp, 1100);
	assert.equal(m.prevXp, 3700);
});

test('search: words and tags', async () => {
	const { parseSearch, fitsSearch, lengthOf } = await import('../src/rules/logic.js');
	assert.equal(lengthOf('1m30'), 90);
	assert.equal(lengthOf('90'), 90);
	assert.equal(lengthOf('2m'), 120);
	const info = { title: 'Clover', difficulty: 'Another', keys: 7, lengthSec: 120, stars: 5.4 };
	const gains = { stamina: 600, speed: 300, jacks: 100 };
	const fits = (t, rate = 1) => fitsSearch(parseSearch(t), info, 1, rate, gains);
	assert.ok(fits('clov'));
	assert.ok(!fits('freedom'));
	assert.ok(fits('length>1m30'));
	assert.ok(!fits('length>1m30', 1.5));
	assert.ok(fits('skill:stamina'));
	assert.ok(fits('skill=speed'));
	assert.ok(!fits('skill:jacks'));
	assert.ok(fits('star-rating>=5'));
	assert.ok(fits('stars=5'));
	assert.ok(!fits('stars>6'));
	assert.ok(fits('clover length<=2m skill:stam star<6'));
});

test('search: != means not', async () => {
	const { parseSearch, fitsSearch } = await import('../src/rules/logic.js');
	const info = { title: 'Clover', difficulty: 'Another', keys: 7, lengthSec: 120, stars: 5.4 };
	const fits = (t) => fitsSearch(parseSearch(t), info, 1, 1, { accuracy: 600, speed: 300, jacks: 50 });
	assert.ok(!fits('skill!=accuracy'));
	assert.ok(fits('skill!=stamina'));
	assert.ok(fits('star!=4'));
	assert.ok(!fits('star!=5'));
	assert.ok(fits('length!=60'));
});


test('strain per minute of the map and its arrows', () => {
	assert.equal(strainPerMinute(100, 106, 3), 2);
	assert.equal(strainPerMinute(100, 106, 0), 0);
	// rested from the last play's end to this one's start: a minute off per minute, not below 0
	assert.equal(restedStrain(100, 2), 98);
	assert.equal(restedStrain(1, 5), 0);
	assert.equal(restedStrain(100, -1), 100);
	assert.equal(strainPerMinute(restedStrain(100, 2), 95, 3), -1);
	assert.equal(arrowsOf(0.02), 0);
	assert.equal(arrowsOf(0.5), 1);
	assert.equal(arrowsOf(1.5), 2);
	assert.equal(arrowsOf(3), 3);
	assert.equal(arrowsOf(9), 3);
	assert.equal(arrowsOf(-0.2), -1);
	assert.equal(arrowsOf(-0.5), -2);
	assert.equal(arrowsOf(-1), -3);
});

test("the strain the game set at a play's end is what it gives later plus the rest since (the game's answers, 16 Nov)", () => {
	// set 07:36:23.401; given 30.667 at 07:39:45.098 and 33.155 at 07:37:15.777: both 34.0 when set
	assert.equal(Math.round(strainWhenSet(30.667, (Date.parse('2026-11-16T07:39:45.098Z') - Date.parse('2026-11-16T07:36:23.401Z')) / 60e3) * 100) / 100, 34.03);
	assert.equal(Math.round(strainWhenSet(33.155, (Date.parse('2026-11-16T07:37:15.777Z') - Date.parse('2026-11-16T07:36:23.401Z')) / 60e3) * 100) / 100, 34.03);
	assert.equal(strainWhenSet(0, 5), 0);
	assert.equal(strainWhenSet(10, -1), 10);
});

test("Skills: a map's rates are one entry, led by its best recent rate, or the one played last", () => {
	const info = { title: 'A', difficulty: '7K', keys: 7, lengthSec: 60 };
	const at = (rate, playedAt, speed) => ({ beatmapId: 1, playedAt, rate, mods: '', gains: { speed }, info, total: speed });
	// none recent: the rate played last leads
	const [speed] = bestBySkill(bestMaps([at(1, 100, 900), at(1.1, 200, 500), at(1.2, 50, 700)]), 5, 1000);
	assert.equal(speed.maps.length, 1);
	assert.equal(speed.maps[0].map.rate, 1.1);
	assert.deepEqual(speed.maps[0].others.map((o) => o.map.rate), [1, 1.2]);
	// 1.0 and 1.1 both recent: the one with more XP per minute leads
	assert.equal(bestBySkill(bestMaps([at(1, 100, 900), at(1.1, 200, 500)]), 5, 50)[0].maps[0].map.rate, 1);
	// only 1.1 recent: it leads
	assert.equal(bestBySkill(bestMaps([at(1, 100, 900), at(1.1, 200, 500)]), 5, 150)[0].maps[0].map.rate, 1.1);
});

test('time tags: ts and te read 5am, 0500, 05:00 and 7pm; day reads today, yesterday and dates', () => {
	assert.equal(timeOf('5am'), 300);
	assert.equal(timeOf('0500'), 300);
	assert.equal(timeOf('05:00'), 300);
	assert.equal(timeOf('7pm'), 1140);
	assert.equal(timeOf('12am'), 0);
	assert.equal(timeOf('5:30pm'), 1050);
	assert.equal(timeOf('25'), null);
	assert.equal(timeOf('13pm'), null);
	const now = new Date(2026, 10, 17, 12).getTime();
	assert.equal(dayOf('today', now), new Date(2026, 10, 17).getTime());
	assert.equal(dayOf('yesterday', now), new Date(2026, 10, 16).getTime());
	assert.equal(dayOf('15nov', now), new Date(2026, 10, 15).getTime());
	assert.equal(dayOf('nov15', now), new Date(2026, 10, 15).getTime());
	assert.equal(dayOf('2026-11-15', now), new Date(2026, 10, 15).getTime());
	assert.equal(dayOf('20dec', now), new Date(2025, 11, 20).getTime()); // later than today: last year
	assert.equal(dayOf('31feb', now), null);
});

test('time tags: plays between ts and te, on a day or on any day, past midnight when te is earlier', () => {
	const now = new Date(2026, 10, 17, 23).getTime(), at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
	const q = parseSearch('day=today ts=5am te=7pm', now);
	assert.equal(searching(q), true);
	assert.equal(playedIn(q, at(17, 5)), true);
	assert.equal(playedIn(q, at(17, 18, 59)), true);
	assert.equal(playedIn(q, at(17, 19)), false);
	assert.equal(playedIn(q, at(16, 12)), false);
	const night = parseSearch('day=16nov ts=22:00 te=0200', now);
	assert.equal(playedIn(night, at(16, 23)), true);
	assert.equal(playedIn(night, at(17, 1)), true);
	assert.equal(playedIn(night, at(17, 3)), false);
	const any = parseSearch('ts=5am te=7am', now);
	assert.equal(playedIn(any, at(3, 6)), true);
	assert.equal(playedIn(any, at(3, 8)), false);
	assert.equal(playedIn(parseSearch('day=yesterday', now), at(16, 0)), true);
	// a tag that can't be read is a word
	assert.deepEqual(parseSearch('ts=soon', now).words, ['ts=soon']);
});

test('All Time Highest: each map\'s best play ever by XP a minute, other rates in its folder', () => {
	const at = (p, t, rate = 1) => ({ ...p, playedAt: t, rate });
	const ever = allTimeBest([
		at(play(1, { speed: 600 }, map(7, 60)), 5),           // newest, worse
		at(play(1, { speed: 900 }, map(7, 60)), 2),           // the best at 1x: 900 a minute
		at(play(1, { speed: 800 }, map(7, 60)), 3, 1.2),      // 1.2x: 800 / (1 / 1.2) = 960 a minute: the map's best
		at(play(2, { stamina: 700 }, map(8, 60)), 4),
	]);
	assert.deepEqual(ever.map((m) => [m.beatmapId, m.rate, Math.round(m.perMinute)]), [[1, 1.2, 960], [2, 1, 700]]);
	assert.equal(ever[0].others.length, 1);
	assert.equal(ever[0].others[0].lastXp, 900);
	assert.equal(ever[0].others[0].n, 2);
	assert.equal(ever[0].prevXp, 0);
});
