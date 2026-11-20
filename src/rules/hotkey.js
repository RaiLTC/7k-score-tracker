// The shortcut that opens the tracker: what a key press is called, and whether it is the saved shortcut. Plain
// JavaScript so the tests can run it directly (npm test).
//
// A letter or digit goes by the key's place on the keyboard (`code`), not by what it types (`key`): on a Mac,
// Option changes what a key types (Option+Shift+S types "Í"), so a shortcut with Alt would never match there.

/** A key press's key as a shortcut names it ("S", "5", "F2"): letters and digits by their place on the keyboard.
 *  @param {{ key: string, code?: string }} e */
export const hotkeyKey = (e) => {
	const place = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code ?? '');
	if (place) return place[1] ?? place[2] ?? '';
	return e.key.length === 1 ? e.key.toUpperCase() : e.key;
};

/** Whether a key press is the shortcut ("Alt+Shift+S"): the same modifiers, and the same key by its place on the
 *  keyboard or by what it types.
 *  @param {string} combo @param {{ key: string, code?: string, ctrlKey: boolean, altKey: boolean, shiftKey: boolean, metaKey: boolean }} e */
export const hotkeyMatches = (combo, e) => {
	const parts = combo.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
	const has = (/** @type {string[]} */ ...names) => parts.some((p) => names.includes(p));
	const key = parts.find((p) => !['ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'super'].includes(p));
	if (!key) return false;
	return e.ctrlKey === has('ctrl', 'control') && e.altKey === has('alt', 'option') && e.shiftKey === has('shift') && e.metaKey === has('meta', 'cmd', 'super')
		&& (hotkeyKey(e).toLowerCase() === key || e.key.toLowerCase() === key);
};
