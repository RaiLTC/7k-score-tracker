// What players can set, saved by the SDK under its own namespaced key (never colliding with the game's options);
// a setting added later simply starts at its default.

import { createSettings, parseHotkey } from '@oss-idle/addon-sdk';
import { hotkeyKey } from './rules/hotkey.js';
import { SKILLS_7K } from './rules/logic.js';

export type View = 'plays' | 'best' | 'skills' | 'suggest' | 'shared';
/** Sharing plays for Shared: 'ask' until the player answers the warning. */
export type Share = 'ask' | 'on' | 'off';
export type Unit = 'h' | 'm' | 's';
export type ButtonStyle = 'solid' | 'outlined' | 'tinted';
export type SkillsAs = 'bar' | 'top';
export type StrainAs = 'bar' | 'change';
/** What the Strain tab suggests: the maps that strain or rest you the most, or the plays that take you to Peak. */
export type StrainMode = 'max' | 'peak';
export type RecentShow = 'show' | 'hide';
export type RecentUnit = 'm' | 'h';
export type OnOff = 'off' | 'on';
export type AccentId = 'neutral' | 'cold' | 'warming' | 'peak' | 'pushing' | 'fatigued' | 'osu' | 'custom';
export type Settings = {
	hotkey: string, view: View, unit: Unit, buttons: ButtonStyle, skillsAs: SkillsAs, strainAs: StrainAs, strainMode: StrainMode, accent: AccentId, customAccent: string,
	recent: RecentShow, recentFor: number, recentUnit: RecentUnit, recentCount: number, bestCount: number, avgOf: number, avgOfRecent: number,
	oldOn: OnOff, oldFor: number, oldUnit: RecentUnit, strainFor: number, strainUnit: RecentUnit,
	/** Rank plays from another skill level, or from before a prestige, last (Effective Maps and Skills). */
	outdateLevel: OnOff, outdatePrestige: OnOff,
	/** Debug's advanced mode: Shift + click on a play copies it. */
	advanced: OnOff,
	/** ADHD Mode (motion and sounds), its volume (0-100), and each of its sounds. */
	genz: OnOff, volume: number,
	/** MySpace Mode: the window as a 2005 MySpace profile, and its dark (edgy) look. */
	myspace: OnOff, myspaceDark: OnOff,
	soundClick: OnOff, soundTab: OnOff, soundOpen: OnOff, soundPlay: OnOff, soundBest: OnOff, soundTicks: OnOff, soundFlash: OnOff, soundCopy: OnOff,
	animButtons: OnOff, animSwitches: OnOff, animWindow: OnOff, animPages: OnOff, animFlash: OnOff, animBars: OnOff, animPlays: OnOff, animRows: OnOff, animConfetti: OnOff, soundSurprise: OnOff, soundHorn: OnOff, surpriseOpen: OnOff,
	/** Mute every ADHD Mode sound; play them only while the game is in front. */
	muteAll: OnOff, focusOnly: OnOff,
	/** All Time Highest's playlist: how many maps, and the XP per time (in the unit shown) they're between; 0 = no max. */
	atCount: number, atMin: number, atMax: number,
	/** The accuracy XP a new play must give a map (more than this) for ADHD Mode's accuracy surprise. */
	surpriseXp: number,
	/** Skills hidden in Most effective maps and the recent list: `hidden`, maps that give it the most XP; `removed`,
	 *  every map it's one of the top 2 skills of. */
	hidden: string[], removed: string[], focused: string[], share: Share,
	/** The game playlist the add-on saves into (0 until the first save). */
	playlistId: number,
};

export const ACCENTS: Record<Exclude<AccentId, 'custom'>, string> = {
	neutral: '#d6d6dc', cold: '#4f9cf5', warming: '#5fc3c0', peak: '#e8c147', pushing: '#f0883e', fatigued: '#c084fc', osu: '#ff66aa',
};

export const DEFAULTS: Settings = {
	hotkey: 'Alt+Shift+S', view: 'plays', unit: 'm', buttons: 'solid', skillsAs: 'bar', strainAs: 'bar', strainMode: 'max', accent: 'neutral', customAccent: '#4fd1c5',
	recent: 'show', recentFor: 1, recentUnit: 'h', recentCount: 10, bestCount: 25, avgOf: 1, avgOfRecent: 0, oldOn: 'off', oldFor: 12, oldUnit: 'h', strainFor: 3, strainUnit: 'h', outdateLevel: 'on', outdatePrestige: 'on', advanced: 'off', genz: 'off', myspace: 'off', myspaceDark: 'off', volume: 50, soundClick: 'on', soundTab: 'on', soundOpen: 'on', soundPlay: 'on', soundBest: 'on', soundTicks: 'on', soundFlash: 'on', soundCopy: 'on', animButtons: 'on', animSwitches: 'on', animWindow: 'on', animPages: 'on', animFlash: 'on', animBars: 'on', animPlays: 'on', animRows: 'on', animConfetti: 'on', soundSurprise: 'on', soundHorn: 'on', surpriseOpen: 'on', muteAll: 'off', focusOnly: 'on', atCount: 25, atMin: 0, atMax: 0, surpriseXp: 2000, hidden: [], removed: [], focused: [], share: 'ask', playlistId: 0,
};

export const settingsStore = createSettings<Settings>('7k-score-tracker', DEFAULTS);

const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? v as T : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

/** The number settings (how long counts as recent, how many maps each list shows, how many plays are averaged): a
 *  whole number from 1 (or `min`) to 999, or null. */
/** All Time Highest's maps, at most. */
export const ALL_TIME_COUNT = 250;

export const NUMBER_SETTINGS = ['recentFor', 'recentCount', 'bestCount', 'avgOf', 'avgOfRecent', 'oldFor', 'strainFor', 'surpriseXp'] as const;
export const wholeOf = (v: unknown, min = 1, max = 999): number | null => {
	const n = Number(v);
	return v !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
/** The lowest each number setting takes: the recent list's plays averaged can be 0, for all of them. */
export const NUMBER_MIN: Partial<Record<typeof NUMBER_SETTINGS[number], number>> = { avgOfRecent: 0, surpriseXp: 0 };
/** The highest, where it isn't 999: the accuracy surprise's XP. */
export const NUMBER_MAX: Partial<Record<typeof NUMBER_SETTINGS[number], number>> & { surpriseXp: number } = { surpriseXp: 99999 };

/** Plays older than this are left out of Most effective maps (when that's on), in milliseconds. */
export const oldMs = (s: Settings): number => s.oldFor * (s.oldUnit === 'h' ? 3600e3 : 60e3);

/** How long counts as recent, in milliseconds. */
export const recentMs = (s: Settings): number => s.recentFor * (s.recentUnit === 'h' ? 3600e3 : 60e3);
/** How far back the Strain tab's plays go. */
export const strainMs = (s: Settings): number => s.strainFor * (s.strainUnit === 'h' ? 3600e3 : 60e3);

/** Saved settings, kept valid: anything broken falls back to its default. */
export const loadSettings = (): Settings => {
	const s = settingsStore.load();
	let hotkey = DEFAULTS.hotkey;
	try { parseHotkey(s.hotkey); hotkey = s.hotkey; } catch { /* the default */ }
	return {
		hotkey,
		view: oneOf(s.view, ['plays', 'best', 'skills', 'suggest', 'shared'], DEFAULTS.view),
		share: oneOf(s.share, ['ask', 'on', 'off'], DEFAULTS.share),
		unit: oneOf(s.unit, ['h', 'm', 's'], DEFAULTS.unit),
		buttons: oneOf(s.buttons, ['solid', 'outlined', 'tinted'], DEFAULTS.buttons),
		skillsAs: oneOf(s.skillsAs, ['bar', 'top'], DEFAULTS.skillsAs),
		strainAs: oneOf(s.strainAs, ['bar', 'change'], DEFAULTS.strainAs),
		strainMode: oneOf(s.strainMode, ['max', 'peak'], DEFAULTS.strainMode),
		accent: oneOf(s.accent, [...Object.keys(ACCENTS) as AccentId[], 'custom'], DEFAULTS.accent),
		customAccent: HEX.test(s.customAccent) ? s.customAccent : DEFAULTS.customAccent,
		recent: oneOf(s.recent, ['show', 'hide'], DEFAULTS.recent),
		recentFor: wholeOf(s.recentFor) ?? DEFAULTS.recentFor,
		strainFor: wholeOf(s.strainFor) ?? DEFAULTS.strainFor,
		recentCount: wholeOf(s.recentCount) ?? DEFAULTS.recentCount,
		bestCount: wholeOf(s.bestCount) ?? DEFAULTS.bestCount,
		avgOf: wholeOf(s.avgOf) ?? DEFAULTS.avgOf,
		avgOfRecent: wholeOf(s.avgOfRecent, 0) ?? DEFAULTS.avgOfRecent,
		oldOn: oneOf(s.oldOn, ['off', 'on'], DEFAULTS.oldOn),
		outdateLevel: oneOf(s.outdateLevel, ['off', 'on'], DEFAULTS.outdateLevel),
		outdatePrestige: oneOf(s.outdatePrestige, ['off', 'on'], DEFAULTS.outdatePrestige),
		advanced: oneOf(s.advanced, ['off', 'on'], DEFAULTS.advanced),
		genz: oneOf(s.genz, ['off', 'on'], DEFAULTS.genz),
		myspace: oneOf(s.myspace, ['off', 'on'], DEFAULTS.myspace),
		myspaceDark: oneOf(s.myspaceDark, ['off', 'on'], DEFAULTS.myspaceDark),
		volume: Number.isInteger(s.volume) && s.volume >= 0 && s.volume <= 100 ? s.volume : DEFAULTS.volume,
		soundClick: oneOf(s.soundClick, ['off', 'on'], DEFAULTS.soundClick),
		soundTab: oneOf(s.soundTab, ['off', 'on'], DEFAULTS.soundTab),
		soundOpen: oneOf(s.soundOpen, ['off', 'on'], DEFAULTS.soundOpen),
		soundPlay: oneOf(s.soundPlay, ['off', 'on'], DEFAULTS.soundPlay),
		soundBest: oneOf(s.soundBest, ['off', 'on'], DEFAULTS.soundBest),
		soundTicks: oneOf(s.soundTicks, ['off', 'on'], DEFAULTS.soundTicks),
		soundFlash: oneOf(s.soundFlash, ['off', 'on'], DEFAULTS.soundFlash),
		animButtons: oneOf(s.animButtons, ['off', 'on'], DEFAULTS.animButtons),
		animSwitches: oneOf(s.animSwitches, ['off', 'on'], DEFAULTS.animSwitches),
		animWindow: oneOf(s.animWindow, ['off', 'on'], DEFAULTS.animWindow),
		animPages: oneOf(s.animPages, ['off', 'on'], DEFAULTS.animPages),
		animFlash: oneOf(s.animFlash, ['off', 'on'], DEFAULTS.animFlash),
		animBars: oneOf(s.animBars, ['off', 'on'], DEFAULTS.animBars),
		animPlays: oneOf(s.animPlays, ['off', 'on'], DEFAULTS.animPlays),
		animRows: oneOf(s.animRows, ['off', 'on'], DEFAULTS.animRows),
		animConfetti: oneOf(s.animConfetti, ['off', 'on'], DEFAULTS.animConfetti),
		soundSurprise: oneOf(s.soundSurprise, ['off', 'on'], DEFAULTS.soundSurprise),
		soundHorn: oneOf(s.soundHorn, ['off', 'on'], DEFAULTS.soundHorn),
		surpriseOpen: oneOf(s.surpriseOpen, ['off', 'on'], DEFAULTS.surpriseOpen),
		muteAll: oneOf(s.muteAll, ['off', 'on'], DEFAULTS.muteAll),
		focusOnly: oneOf(s.focusOnly, ['off', 'on'], DEFAULTS.focusOnly),
		atCount: wholeOf(s.atCount, 1, ALL_TIME_COUNT) ?? DEFAULTS.atCount,
		atMin: wholeOf(s.atMin, 0, 99999999) ?? DEFAULTS.atMin,
		atMax: wholeOf(s.atMax, 0, 99999999) ?? DEFAULTS.atMax,
		surpriseXp: wholeOf(s.surpriseXp, 0, NUMBER_MAX.surpriseXp) ?? DEFAULTS.surpriseXp,
		soundCopy: oneOf(s.soundCopy, ['off', 'on'], DEFAULTS.soundCopy),
		oldFor: wholeOf(s.oldFor) ?? DEFAULTS.oldFor,
		oldUnit: oneOf(s.oldUnit, ['m', 'h'], DEFAULTS.oldUnit),
		hidden: Array.isArray(s.hidden) ? s.hidden.filter((sk) => (SKILLS_7K as readonly string[]).includes(sk)) : [],
		removed: Array.isArray(s.removed) ? s.removed.filter((sk) => (SKILLS_7K as readonly string[]).includes(sk)) : [],
		focused: Array.isArray(s.focused) ? s.focused.filter((sk) => (SKILLS_7K as readonly string[]).includes(sk)) : [],
		playlistId: Number.isInteger(s.playlistId) && s.playlistId > 0 ? s.playlistId : 0,
		recentUnit: oneOf(s.recentUnit, ['m', 'h'], DEFAULTS.recentUnit),
		strainUnit: oneOf(s.strainUnit, ['m', 'h'], DEFAULTS.strainUnit),
	};
};

/** The accent as a colour. */
export const accentOf = (s: Settings): string => (s.accent === 'custom' ? s.customAccent : ACCENTS[s.accent]);

/** A key press as a hotkey ("Alt+Shift+S"), or null for a lone modifier. It needs Ctrl, Alt or Meta, so it can't
 *  take a key the player types or plays with. */
export const hotkeyOf = (e: KeyboardEvent): string | null | 'needs-modifier' => {
	if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
	if (!e.ctrlKey && !e.altKey && !e.metaKey) return 'needs-modifier';
	// letters and digits by their place on the keyboard: on a Mac, Option changes what they type
	return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', hotkeyKey(e)].filter(Boolean).join('+');
};

/** "Alt+Shift+S" as players read it: "Alt + Shift + S". */
export const hotkeyLabel = (combo: string): string => combo.split('+').join(' + ');
