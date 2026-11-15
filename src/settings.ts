// What players can set, saved by the SDK under its own namespaced key (never colliding with the game's options);
// a setting added later simply starts at its default.

import { createSettings, parseHotkey } from '@oss-idle/addon-sdk';
import { SKILLS_7K } from './logic.js';

export type View = 'plays' | 'best' | 'skills';
export type Unit = 'h' | 'm' | 's';
export type ButtonStyle = 'solid' | 'outlined' | 'tinted';
export type SkillsAs = 'bar' | 'top';
export type RecentShow = 'show' | 'hide';
export type RecentUnit = 'm' | 'h';
export type OnOff = 'off' | 'on';
export type AccentId = 'neutral' | 'cold' | 'warming' | 'peak' | 'pushing' | 'fatigued' | 'osu' | 'custom';
export type Settings = {
	hotkey: string, view: View, unit: Unit, buttons: ButtonStyle, skillsAs: SkillsAs, accent: AccentId, customAccent: string,
	recent: RecentShow, recentFor: number, recentUnit: RecentUnit, recentCount: number, bestCount: number, avgOf: number, avgOfRecent: number,
	oldOn: OnOff, oldFor: number, oldUnit: RecentUnit,
	/** Skills whose maps (the ones they give the most XP to) are left out of Most effective maps and the recent list. */
	hidden: string[],
	/** The game playlist the add-on saves into (0 until the first save). */
	playlistId: number,
};

export const ACCENTS: Record<Exclude<AccentId, 'custom'>, string> = {
	neutral: '#d6d6dc', cold: '#4f9cf5', warming: '#5fc3c0', peak: '#e8c147', pushing: '#f0883e', fatigued: '#c084fc', osu: '#ff66aa',
};

export const DEFAULTS: Settings = {
	hotkey: 'Alt+Shift+S', view: 'plays', unit: 'm', buttons: 'solid', skillsAs: 'bar', accent: 'neutral', customAccent: '#4fd1c5',
	recent: 'show', recentFor: 1, recentUnit: 'h', recentCount: 10, bestCount: 25, avgOf: 1, avgOfRecent: 0, oldOn: 'off', oldFor: 12, oldUnit: 'h', hidden: [], playlistId: 0,
};

export const settingsStore = createSettings<Settings>('7k-score-tracker', DEFAULTS);

const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? v as T : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

/** The number settings (how long counts as recent, how many maps each list shows, how many plays are averaged): a
 *  whole number from 1 (or `min`) to 999, or null. */
export const NUMBER_SETTINGS = ['recentFor', 'recentCount', 'bestCount', 'avgOf', 'avgOfRecent', 'oldFor'] as const;
export const wholeOf = (v: unknown, min = 1): number | null => {
	const n = Number(v);
	return v !== '' && Number.isInteger(n) && n >= min && n <= 999 ? n : null;
};
/** The lowest each number setting takes: the recent list's plays averaged can be 0, for all of them. */
export const NUMBER_MIN: Partial<Record<typeof NUMBER_SETTINGS[number], number>> = { avgOfRecent: 0 };

/** Plays older than this are left out of Most effective maps (when that's on), in milliseconds. */
export const oldMs = (s: Settings): number => s.oldFor * (s.oldUnit === 'h' ? 3600e3 : 60e3);

/** How long counts as recent, in milliseconds. */
export const recentMs = (s: Settings): number => s.recentFor * (s.recentUnit === 'h' ? 3600e3 : 60e3);

/** Saved settings, kept valid: anything broken falls back to its default. */
export const loadSettings = (): Settings => {
	const s = settingsStore.load();
	let hotkey = DEFAULTS.hotkey;
	try { parseHotkey(s.hotkey); hotkey = s.hotkey; } catch { /* the default */ }
	return {
		hotkey,
		view: oneOf(s.view, ['plays', 'best', 'skills'], DEFAULTS.view),
		unit: oneOf(s.unit, ['h', 'm', 's'], DEFAULTS.unit),
		buttons: oneOf(s.buttons, ['solid', 'outlined', 'tinted'], DEFAULTS.buttons),
		skillsAs: oneOf(s.skillsAs, ['bar', 'top'], DEFAULTS.skillsAs),
		accent: oneOf(s.accent, [...Object.keys(ACCENTS) as AccentId[], 'custom'], DEFAULTS.accent),
		customAccent: HEX.test(s.customAccent) ? s.customAccent : DEFAULTS.customAccent,
		recent: oneOf(s.recent, ['show', 'hide'], DEFAULTS.recent),
		recentFor: wholeOf(s.recentFor) ?? DEFAULTS.recentFor,
		recentCount: wholeOf(s.recentCount) ?? DEFAULTS.recentCount,
		bestCount: wholeOf(s.bestCount) ?? DEFAULTS.bestCount,
		avgOf: wholeOf(s.avgOf) ?? DEFAULTS.avgOf,
		avgOfRecent: wholeOf(s.avgOfRecent, 0) ?? DEFAULTS.avgOfRecent,
		oldOn: oneOf(s.oldOn, ['off', 'on'], DEFAULTS.oldOn),
		oldFor: wholeOf(s.oldFor) ?? DEFAULTS.oldFor,
		oldUnit: oneOf(s.oldUnit, ['m', 'h'], DEFAULTS.oldUnit),
		hidden: Array.isArray(s.hidden) ? s.hidden.filter((sk) => (SKILLS_7K as readonly string[]).includes(sk)) : [],
		playlistId: Number.isInteger(s.playlistId) && s.playlistId > 0 ? s.playlistId : 0,
		recentUnit: oneOf(s.recentUnit, ['m', 'h'], DEFAULTS.recentUnit),
	};
};

/** The accent as a colour. */
export const accentOf = (s: Settings): string => (s.accent === 'custom' ? s.customAccent : ACCENTS[s.accent]);

/** A key press as a hotkey ("Alt+Shift+S"), or null for a lone modifier. It needs Ctrl, Alt or Meta, so it can't
 *  take a key the player types or plays with. */
export const hotkeyOf = (e: KeyboardEvent): string | null | 'needs-modifier' => {
	if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
	if (!e.ctrlKey && !e.altKey && !e.metaKey) return 'needs-modifier';
	const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
	return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('+');
};

/** "Alt+Shift+S" as players read it: "Alt + Shift + S". */
export const hotkeyLabel = (combo: string): string => combo.split('+').join(' + ');
