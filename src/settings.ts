// What players can set, saved by the SDK under its own namespaced key (never colliding with the game's options);
// a setting added later simply starts at its default.

import { createSettings, parseHotkey } from '@oss-idle/addon-sdk';

export type View = 'plays' | 'best';
export type Settings = { hotkey: string, view: View };

export const DEFAULTS: Settings = { hotkey: 'Alt+Shift+S', view: 'plays' };

export const settingsStore = createSettings<Settings>('7k-score-tracker', DEFAULTS);

/** Saved settings, kept valid: a broken hotkey falls back to the default. */
export const loadSettings = (): Settings => {
	const s = settingsStore.load();
	let hotkey = DEFAULTS.hotkey;
	try { parseHotkey(s.hotkey); hotkey = s.hotkey; } catch { /* the default */ }
	return { hotkey, view: s.view === 'best' ? 'best' : 'plays' };
};

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
