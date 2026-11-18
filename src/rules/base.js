// Base XP: a play's XP with your bonuses taken back out, for Shared (everyone's plays, each map's base XP). Pure: the
// multiplier history is kept by game/data.ts (run with `npm test`).
// The game's XP for a play (server/rulesets/mania/xpRules.ts applyXpRules): the bot's raw XP times each skill's
// multiplier (upgrades × prestige × genetics × medals, the API's xp_multipliers.total), fatigue (physical skills),
// mindblock (the mindblock skills), and the mods; then a first X adds accuracy XP. Taken back out here are the
// multiplier, the mods and mindblock; a play the rest can't be taken out of exactly isn't used: fatigued, a first X
// maybe (100% accuracy), No Fail, or a map replayed so much mindblock took over a tenth.

import { num } from './logic.js';
import { MINDBLOCK_FREE, mindblockFactor } from './peak.js';

/** @typedef {[at: number, total: number]} MultiplierMark  a skill's XP multiplier from `at` on */
/** @typedef {Record<string, MultiplierMark[]>} MultiplierHistory  each skill's marks, oldest first */

/** How many marks each skill keeps: the newest. */
const KEEP = 200;
/** The strain bar after a play from which it's in the Fatigued zone (the game cuts physical XP there). */
export const FATIGUED_BAR = 0.8;
/** Mindblock may take at most this share of a play's XP for it to be used. */
const MINDBLOCK_MAX = 0.1;
/** The game's mods' XP (shared/rulesets/mania/7k/modXp.ts): No Fail earns nothing, Easy half, Hard Rock 10% more
 *  accuracy. @param {string} mods @param {string} skill */
export const modXp = (mods, skill) => {
	const m = String(mods).toUpperCase();
	return (m.includes('NF') ? 0 : 1) * (m.includes('EZ') ? 0.5 : 1) * (m.includes('HR') && skill === 'accuracy' ? 1.1 : 1);
};

/**
 * Notes each skill's XP multiplier from the game's answer (skills[sk].xp_multipliers.total), when it changed, from
 * `at`. Unlike levels, the first mark starts at `at`: plays from before it have no known multiplier.
 * @param {MultiplierHistory} history @param {Record<string, { xp_multipliers?: { total?: unknown } }>} skills @param {number} at
 * @returns {boolean} whether anything changed
 */
export const noteMultipliers = (history, skills, at) => {
	let changed = false;
	for (const [sk, s] of Object.entries(skills)) {
		const total = Number(s?.xp_multipliers?.total);
		if (!(total > 0)) continue;
		const marks = (history[sk] ??= []), last = marks[marks.length - 1];
		if (last && last[1] === total) continue;
		marks.push([last ? Math.max(at, last[0]) : at, total]);
		marks.splice(0, Math.max(0, marks.length - KEEP));
		changed = true;
	}
	return changed;
};

/** A skill's multiplier when it was played (the mark in effect then), or 0 when none was noted yet then.
 *  @param {MultiplierHistory} history @param {string} skill @param {number} at */
export const multiplierAt = (history, skill, at) => {
	let total = 0;
	for (const [from, t] of history[skill] ?? []) if (from <= at) total = t;
	return total;
};

/** How many times the map was played in your last 50 plays, within a day, before this one (what mindblock counts).
 *  @param {{ beatmapId: number, playedAt: number }[]} plays newest first @param {number} index the play's */
export const recentOfMap = (plays, index) => {
	const p = plays[index];
	if (!p) return 0;
	return plays.slice(index + 1, index + 51).filter((q) => q.beatmapId === p.beatmapId && p.playedAt - q.playedAt < 864e5).length;
};

/**
 * A play's base XP per skill (its XP with the bonuses taken back out), or why it can't be used.
 * @param {{ playedAt: number, mods: string, gains: Record<string, number>, total: number, acc?: number }} play
 * @param {{ history: MultiplierHistory, recent: number, bar?: number }} at  the multiplier history, the map's plays
 *   before it (mindblock), and the strain bar after it
 * @returns {{ base: Record<string, number> } | { skip: string }}
 */
export const baseXp = (play, { history, recent, bar }) => {
	if (!(play.total > 0)) return { skip: 'no XP' };
	if (String(play.mods).toUpperCase().includes('NF')) return { skip: 'No Fail' };
	if (num(play.acc) >= 1) return { skip: '100% accuracy (a first X may have added XP)' };
	if (typeof bar !== 'number') return { skip: 'strain not noted' };
	if (bar >= FATIGUED_BAR) return { skip: 'fatigued' };
	const block = mindblockFactor(recent);
	if (block < 1 - MINDBLOCK_MAX) return { skip: 'mindblock' };
	/** @type {Record<string, number>} */
	const base = {};
	for (const [sk, v] of Object.entries(play.gains)) {
		if (!(num(v) > 0)) continue;
		const total = multiplierAt(history, sk, play.playedAt);
		if (!total) return { skip: 'multiplier not noted yet' };
		const blocked = MINDBLOCK_FREE.includes(sk) ? 1 : block;
		base[sk] = Math.round((num(v) / total / modXp(play.mods, sk) / blocked) * 100) / 100;
	}
	return { base };
};
