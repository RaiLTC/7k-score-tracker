// What players can set, saved by the SDK under its own namespaced key (never colliding with the game's options);
// a setting added later simply starts at its default.

import { createSettings, parseHotkey } from '@oss-idle/addon-sdk';

export type View = 'plays' | 'best' | 'skills';
export type Unit = 'h' | 'm' | 's';
export type ButtonStyle = 'solid' | 'outlined' | 'tinted';
export type SkillsAs = 'bar' | 'top';
export type AccentId = 'neutral' | 'cold' | 'warming' | 'peak' | 'pushing' | 'fatigued' | 'osu' | 'custom';
export type Settings = {
	hotkey: string, view: View, unit: Unit, buttons: ButtonStyle, skillsAs: SkillsAs, accent: AccentId, customAccent: string,
};

export const ACCENTS: Record<Exclude<AccentId, 'custom'>, string> = {
	neutral: '#d6d6dc', cold: '#4f9cf5', warming: '#5fc3c0', peak: '#e8c147', pushing: '#f0883e', fatigued: '#c084fc', osu: '#ff66aa',
};

export const DEFAULTS: Settings = {
	hotkey: 'Alt+Shift+S', view: 'plays', unit: 'm', buttons: 'solid', skillsAs: 'bar', accent: 'neutral', customAccent: '#4fd1c5',
};

export const settingsStore = createSettings<Settings>('7k-score-tracker', DEFAULTS);

const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? v as T : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

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
