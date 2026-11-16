// To Peak: the game's bar and mindblock formulas, and the plan (run with `npm test`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mindblockFactor, peakMinutes, planToPeak, strainBar } from '../src/rules/peak.js';

const near = (a, b, d = 1e-4) => assert.ok(Math.abs(a - b) < d, `${a} is not ${b}`);

test('the bar is the game\'s: strain minutes and the bar it gave (7 Stamina upgrades, 16 Nov)', () => {
	for (const [minutes, bar] of [[38.255, 0.42580], [34, 0.42038], [21.84, 0.40488], [16.056, 0.35660], [29.054, 0.41407]]) near(strainBar(minutes, 7), bar);
	const [start, end] = peakMinutes(7);
	near(strainBar(start, 7), 0.4);
	near(strainBar(end, 7), 0.6);
});

test('mindblock: no cut at first, a quarter of the XP after 25 plays of the map', () => {
	assert.equal(mindblockFactor(0), 1);
	near(mindblockFactor(25), 0.25);
	near(mindblockFactor(100), 0.25);
	assert.ok(mindblockFactor(10) < mindblockFactor(5));
});

const map = (key, change, free, blocked, lengthMin = 1, recent = 0) => ({ key, beatmapId: 1, lengthMin, change, free, blocked, recent });

test('to Peak: a map mindblock doesn\'t cut repeats, as many times as it takes', () => {
	const plan = planToPeak(200, 175, [map('jacks', -1, 1000, 0), map('other', -1, 500, 0)]);
	assert.deepEqual(plan.steps, [{ key: 'jacks', count: 25 }]);
	assert.equal(plan.reached, true);
});

test('to Peak: a map mindblock cuts hands over to the next once it\'s worth less', () => {
	// fresh, the mindblock map is worth more; repeated, it drops under the other and hands over
	const plan = planToPeak(220, 175, [map('tech', -2, 0, 1000), map('jacks', -2, 900, 0)]);
	assert.equal(plan.steps[0]?.key, 'tech');
	// already repeated a lot today: the other map from the start
	assert.equal(planToPeak(220, 175, [map('tech', -2, 0, 1000, 1, 9), map('jacks', -2, 900, 0)]).steps[0]?.key, 'jacks');
	assert.ok(plan.steps.some((s) => s.key === 'jacks'));
	assert.equal(plan.reached, true);
});

test('to Peak: only maps that move strain the right way, and none when already there', () => {
	assert.deepEqual(planToPeak(10, 18, [map('cool', -1, 1000, 0), map('warm', 2, 10, 0)]).steps, [{ key: 'warm', count: 4 }]);
	assert.equal(planToPeak(50, 50, [map('warm', 2, 10, 0)]).plays, 0);
	assert.equal(planToPeak(500, 175, [map('cool', -1, 10, 0)]).reached, false);
});
