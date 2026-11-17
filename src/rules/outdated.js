// Outdated plays: a skill's level (or prestige) moved on since you played a map, so its XP no longer matches what
// the map gives you now. Pure: the history is kept by game/data.ts (run with `npm test`).

import { num } from './logic.js';

/** @typedef {[at: number, level: number, prestige: number]} LevelMark  a skill's level and prestige from `at` on */
/** @typedef {Record<string, LevelMark[]>} LevelHistory  each skill's marks, oldest first */
/** @typedef {{ level: boolean, prestige: boolean }} OutdateBy  what makes a play outdated (the settings) */
/** @typedef {'' | 'level' | 'prestige'} Outdated */

/** How many marks each skill keeps: the newest. */
const KEEP = 200;

/**
 * Notes each skill's level and prestige from the game's answer, when they changed, from `at` (the newest play's
 * time: the play that moved them). The first mark of a skill starts at 0, so plays from before it count as current.
 * @param {LevelHistory} history @param {Record<string, { level?: unknown, prestige?: unknown }>} skills @param {number} at
 * @returns {boolean} whether anything changed
 */
export const noteLevels = (history, skills, at) => {
	let changed = false;
	for (const [sk, s] of Object.entries(skills)) {
		const level = num(s?.level), prestige = num(s?.prestige);
		const marks = (history[sk] ??= []), last = marks[marks.length - 1];
		if (last && last[1] === level && last[2] === prestige) continue;
		marks.push([last ? Math.max(at, last[0]) : 0, level, prestige]);
		marks.splice(0, Math.max(0, marks.length - KEEP));
		changed = true;
	}
	return changed;
};

/**
 * Whether a play is outdated for a skill: its prestige or level then (the mark in effect when it was played) isn't the
 * skill's now. '' when it isn't (or nothing was noted yet).
 * @param {LevelHistory} history @param {string} skill @param {number} playedAt @param {OutdateBy} by
 * @returns {Outdated}
 */
export const outdatedFor = (history, skill, playedAt, by) => {
	const marks = history[skill];
	if (!marks?.length || (!by.level && !by.prestige)) return '';
	const now = /** @type {LevelMark} */ (marks[marks.length - 1]);
	let then = marks[0];
	for (const m of marks) if (m[0] <= playedAt) then = m;
	if (!then) return '';
	if (by.prestige && then[2] !== now[2]) return 'prestige';
	if (by.level && then[1] !== now[1]) return 'level';
	return '';
};
