// The shortcut that opens the tracker (run with `npm test`).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hotkeyKey, hotkeyMatches } from '../src/rules/hotkey.js';

const press = (key, code, mods = {}) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('a letter or digit is named by its place on the keyboard', () => {
	assert.equal(hotkeyKey(press('s', 'KeyS')), 'S');
	// a Mac: Option+Shift+S types "Í"
	assert.equal(hotkeyKey(press('Í', 'KeyS', { altKey: true, shiftKey: true })), 'S');
	assert.equal(hotkeyKey(press('@', 'Digit2', { shiftKey: true })), '2');
	assert.equal(hotkeyKey(press('F2', 'F2')), 'F2');
	assert.equal(hotkeyKey(press('/', 'Slash')), '/');
});

test('the default shortcut opens the tracker on Windows and on a Mac', () => {
	assert.ok(hotkeyMatches('Alt+Shift+S', press('S', 'KeyS', { altKey: true, shiftKey: true })));
	assert.ok(hotkeyMatches('Alt+Shift+S', press('Í', 'KeyS', { altKey: true, shiftKey: true })));
});

test('the modifiers must be the same', () => {
	assert.ok(!hotkeyMatches('Alt+Shift+S', press('s', 'KeyS', { altKey: true })));
	assert.ok(!hotkeyMatches('Alt+Shift+S', press('S', 'KeyS', { altKey: true, shiftKey: true, ctrlKey: true })));
	assert.ok(hotkeyMatches('Cmd+K', press('k', 'KeyK', { metaKey: true })));
	assert.ok(!hotkeyMatches('Alt+Shift+S', press('D', 'KeyD', { altKey: true, shiftKey: true })));
});

test('a shortcut saved by what the key types still works', () => {
	// e.g. a shortcut recorded before letters went by their place
	assert.ok(hotkeyMatches('Ctrl+Í', press('Í', 'KeyS', { ctrlKey: true })));
	assert.ok(hotkeyMatches('Ctrl+F2', press('F2', 'F2', { ctrlKey: true })));
});
