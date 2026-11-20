// The add-on: its window in a shadow root, the shortcut (set in Settings), and loading the lists. Everything
// registered here is undone by the SDK when the add-on stops (disabled, updated or removed). Nothing runs while the
// window is closed, and while it's open, only clicks and keys do anything.

import { Addon, buildMeta, gameHost, HotkeyManager, isolateInput, keepFocus } from '@oss-idle/addon-sdk';
import { createGenZ } from './ui/genz.js';
import { type SharedStats, type SharedTable, FETCH_AFTER, fetchIn, fetchStats, fetchTable, nextSendAt, sendBatch, sentCount, waitingCount, sharedInfos, sharedTable, startSharing, tableDue, takeNote } from './game/shared.js';
import { noteSurprise, surprised } from './game/surprise.js';
import { TrackerError, allTime7k, basePlays, debugData, debugPlay, latestMark, levelHistory, noteStrain, recent7k, savePlaylist, strainNow, strainOf, strainWaiting } from './game/data.js';
import { outdatedFor } from './rules/outdated.js';
import { hotkeyMatches } from './rules/hotkey.js';
import { agoText, allTimeBest, type BestEver, bestMaps, fitsSearch, mainSkill, type MapInfo, type MapStats, num, parseSearch, type Play, playedIn, type Search, searching, topSkills } from './rules/logic.js';
import { accentOf, ACCENTS, ALL_TIME_COUNT, DEFAULTS, hotkeyLabel, hotkeyOf, loadSettings, NUMBER_MAX, NUMBER_MIN, NUMBER_SETTINGS, oldMs, recentMs, settingsStore, strainMs, wholeOf, type AccentId, type Settings, type View } from './settings.js';
import { MINDBLOCK_FREE, type PeakMap, peakMinutes, planToPeak, strainBar } from './rules/peak.js';
import { arrowsOf } from './rules/strain.js';
import styles from './ui/styles.css';
import { CHANGELOG } from './ui/changelog.js';
import { TEXT } from './ui/text.js';
import { allTimeHtml, bestHtml, bySkillHtml, changelogHtml, esc, gradeScale, legendHtml, listedPlays, messageHtml, PER_MINUTE, playsHtml, sharedHtml, type SharedRow, type SharedSong, sharedSongs, showStrainAs } from './ui/view.js';

type Api = Parameters<typeof recent7k>[0];
type Page = View | 'settings' | 'debug' | 'changelog';
/** The pages that aren't lists: no unit switch, and no lists drawn for them. */
const TOOL_PAGES: Page[] = ['settings', 'debug', 'changelog'];

/** How often, while the window is open, it checks for a new play. */
const POLL_MS = 10000;
/** How many maps each Strain group has, and how far back its plays go. */
const SUGGEST_COUNT = 5;
/** How long Refresh waits after a press before it can be pressed again. */
const REFRESH_COOLDOWN = 3000;
/** How many Recent plays rows are drawn at a time. */
const PLAYS_BATCH = 50;
/** Debug: how many plays its two lists show (Recent Plays, and their base XP). */
const DEBUG_LIST = 100;

// Tabler Icons (MIT): bug, outline
const BUG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9v-1a3 3 0 0 1 6 0v1"/><path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3"/><path d="M3 13l4 0"/><path d="M17 13l4 0"/><path d="M12 20l0 -6"/><path d="M4 19l3.35 -2"/><path d="M20 19l-3.35 -2"/><path d="M4 7l3.75 2.4"/><path d="M20 7l-3.75 2.4"/></svg>';
// Tabler Icons (MIT): news, outline
const NEWS = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1 -4 0v-13a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1v12a3 3 0 0 0 3 3h11"/><path d="M8 8l4 0"/><path d="M8 12l4 0"/><path d="M8 16l4 0"/></svg>';
// Tabler Icons (MIT): settings, outline
const GEAR = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/></svg>';

/** Text that reads on the accent: dark on a light colour, white on a dark one (WCAG relative luminance). */
const onAccent = (hex: string): string => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? '#17181d' : '#ffffff';
};

/** A choice between a few options, as a segmented control of radios. */
const choice = (key: keyof Settings, label: string, options: Record<string, string>) =>
	`<span class="seg" role="radiogroup" aria-label="${label}">${Object.entries(options).map(([value, text]) =>
		`<button type="button" role="radio" data-set="${key}" data-value="${value}" aria-checked="false">${text}</button>`).join('')}</span>`;

/** The game blocks Backspace and Delete before they reach a field: when it has, they're done here instead. Whether
 *  they were. */
const deleteKeys = (input: HTMLInputElement, e: KeyboardEvent): boolean => {
	if (!e.defaultPrevented || (e.key !== 'Backspace' && e.key !== 'Delete')) return false;
	const v = input.value, from = input.selectionStart ?? v.length, to = input.selectionEnd ?? from;
	const [start, end] = from !== to ? [from, to] : e.key === 'Backspace' ? [Math.max(0, from - 1), from] : [from, Math.min(v.length, from + 1)];
	input.value = v.slice(0, start) + v.slice(end);
	input.setSelectionRange(start, start);
	return true;
};

const settingRow = (label: string, help: string, control: string, attrs = '') =>
	`<div class="settings-row"><div class="label"><div>${label}</div>${help || attrs ? `<div class="muted"${attrs}>${help}</div>` : ''}</div>${control}</div>`;

export class Tracker extends Addon {
	private readonly hotkeys = new HotkeyManager();
	private settings: Settings = loadSettings();
	private toggleKey?: () => void;
	private escape?: () => void;
	private recording = false;
	private loading = 0;
	private poll = 0;
	private mark = '';
	private drawnAt = 0;

	constructor() {
		super({ name: TEXT.name });
	}

	private save(patch: Partial<Settings>): void {
		this.settings = { ...this.settings, ...patch };
		settingsStore.save(this.settings);
	}

	protected onMount(): void {
		const host = document.createElement('div');
		host.id = '7k-score-tracker';
		// above the game's cursor layer (100000): over the window the game's cursor is hidden and the system one shows
		host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100001;';
		const root = host.attachShadow({ mode: 'open' });
		const swatches = ([...Object.entries(ACCENTS), ['custom', '']] as [string, string][]).map(([id, color]) =>
			`<button type="button" role="radio" data-accent="${id}" aria-checked="false" aria-label="${TEXT.accents[id]}" title="${TEXT.accents[id]}"${color ? ` style="background:${color}"` : ' class="custom"'}></button>`).join('');
		root.innerHTML = `<style>${styles}</style>
			<div class="window" role="dialog" aria-label="${TEXT.name}" hidden>
				<div class="head">
					<div class="title-row">
						<span class="title">${TEXT.name}</span><span class="versions" data-versions></span>
						<span class="spacer"></span>
						<button type="button" class="icon-btn" data-action="debug" aria-label="${TEXT.debug}" title="${TEXT.debug}" aria-pressed="false">${BUG}</button>
						<button type="button" class="icon-btn" data-action="changelog" aria-label="${TEXT.changelog}" title="${TEXT.changelog}" aria-pressed="false">${NEWS}</button>
						<button type="button" class="icon-btn" data-action="settings" aria-label="${TEXT.settings}" title="${TEXT.settings}" aria-pressed="false">${GEAR}</button>
						<button type="button" class="close" data-action="close" aria-label="${TEXT.close}" title="${TEXT.close}">✕</button>
					</div>
					<div class="tab-row">
						<span class="seg" role="tablist" aria-label="${TEXT.views}">
							<button type="button" role="tab" data-view="plays" aria-selected="true">${TEXT.tabs.plays}</button>
							<button type="button" role="tab" data-view="best" aria-selected="false">${TEXT.tabs.best}</button>
							<button type="button" role="tab" data-view="skills" aria-selected="false">${TEXT.tabs.skills}</button>
							<button type="button" role="tab" data-view="suggest" aria-selected="false">${TEXT.tabs.suggest}</button>
							<button type="button" role="tab" data-view="shared" aria-selected="false">${TEXT.tabs.shared}</button>
						</span>
						<div class="search"><input type="search" class="search-field" placeholder="${TEXT.search}" aria-label="${TEXT.search}" autocomplete="off" spellcheck="false" data-search><button type="button" class="search-help" data-action="search-help" aria-label="${TEXT.searchOps}" title="${TEXT.searchOps}" aria-expanded="false">?</button>
						<div class="search-pop" role="dialog" aria-label="${TEXT.searchOps}" hidden><div class="search-pop-head"><span class="title">${TEXT.searchOpsTitle}</span><button type="button" class="close" data-action="search-help" aria-label="${TEXT.close}" title="${TEXT.close}">✕</button></div>
							<div class="muted">${TEXT.searchOpsNote}</div>
							<div class="ops">${TEXT.searchOpsList.map(([op, what]) => `<code>${op}</code><span>${what}</span>`).join('')}</div>
							<div class="ops" data-advanced-only hidden>${TEXT.searchOpsAdvanced.map(([op, what]) => `<code>${op}</code><span>${what}</span>`).join('')}</div>
							<div class="ops-label muted">${TEXT.searchOpsCompare}</div>
							<div class="ops">${TEXT.searchCompareList.map(([op, what]) => `<code>${op}</code><span>${what}</span>`).join('')}</div></div></div>
						<span data-unit-switch>${choice('unit', TEXT.unit, TEXT.units)}</span>
						<button type="button" class="btn" data-action="refresh">${TEXT.refresh}</button>
					</div>
				</div>
				<div class="panels">
					<section class="card plays"><div class="card-head"><span class="title">${TEXT.plays}</span><span class="muted" data-count></span><span class="filter" data-filter hidden><span data-filter-name></span><button type="button" class="btn small" data-only="">${TEXT.showAll}</button></span></div><div class="list" data-list="plays"></div></section>
					<section class="card legend" hidden><div class="card-head"><span class="title">${TEXT.skillsTitle}</span><span class="muted">${TEXT.skillsNote}</span><button type="button" class="btn small reset-all" data-action="reset-skills">${TEXT.resetAll}</button></div><div class="legend-list">${legendHtml()}</div></section>
					<section class="card best recent-best" hidden><div class="card-head"><span class="title" data-recent-title></span><span class="muted" data-recent-note></span><button type="button" class="btn small save-playlist" data-action="save-playlist" title="${TEXT.savePlaylistHelp}">${TEXT.savePlaylist}</button></div><div class="list" data-list="recent"></div></section>
					<section class="card best" hidden><div class="card-head"><span class="title" data-best-title>${TEXT.best}</span><span class="muted" data-best-note></span><span class="all-time-save" data-all-time-save hidden>${([['atCount', TEXT.atMaps, '3', ''], ['atMin', TEXT.atMin, '8', ''], ['atMax', TEXT.atMax, '8', TEXT.atMaxAny]] as const).map(([key, label, max, empty]) => `<label class="inline-field">${label}<input type="text" class="num-field" inputmode="numeric" maxlength="${max}" autocomplete="off" spellcheck="false" placeholder="${empty}" data-at="${key}"></label>`).join('')}<button type="button" class="btn small" data-action="save-all-time">${TEXT.savePlaylist}</button></span><button type="button" class="btn small all-time" data-action="all-time">${TEXT.allTime}</button></div><div class="list" data-list="best"></div></section>
					<section class="card by-skill" hidden><div class="card-head"><span class="title">${TEXT.bySkill}</span><span class="muted">${TEXT.bySkillNote}</span></div><div class="list" data-list="skills"></div></section>
					<section class="card suggest" hidden><div class="card-head"><span class="title">${TEXT.suggestTitle}</span><span class="muted">${TEXT.suggestNote}</span><span class="suggest-from">${choice('strainMode', TEXT.strainMode, TEXT.strainModeOptions)}</span><button type="button" class="btn small suggest-now" data-action="suggest" title="${TEXT.suggestHelp}">${TEXT.suggest}</button></div>
						<div class="suggest-warn">${TEXT.suggestWarn}</div>
						<div class="suggest-body" data-suggest>${messageHtml(TEXT.suggestFirst)}</div></section>
					<section class="card shared" hidden><div class="card-head"><span class="title">${TEXT.shared}</span><span class="muted">${TEXT.sharedNote}</span><span class="muted shared-status" data-shared-status></span><button type="button" class="btn small" data-action="pick-open">${TEXT.pickOpen}</button></div><div class="shared-stats"><span>${TEXT.statYou}<b data-stat="you">–</b></span><span>${TEXT.statPool}<b data-stat="pool">–</b></span><span>${TEXT.statPlayers}<b data-stat="players">–</b></span><span>${TEXT.statRate}<b data-stat="rate">–</b></span><span data-next-batch hidden>${TEXT.statNext}<b data-stat="next">0</b><i data-stat="next-in"></i></span><span data-fetch class="idle">${TEXT.statFetch}<b data-stat="fetch">01:00</b></span></div><div class="list" data-list="shared"></div></section>
					<section class="card debug" hidden><div class="card-head"><span class="title">${TEXT.debug}</span><span class="muted">${TEXT.debugNote}</span><button type="button" class="btn small copy-all" data-action="advanced" aria-pressed="false" title="${TEXT.advancedHelp}">${TEXT.advanced}</button><button type="button" class="btn small" data-action="copy" data-copy="all">${TEXT.copyAll}</button></div><div class="debug-body" data-debug></div></section>
					<section class="card changelog" hidden><div class="card-head"><span class="title">${TEXT.changelog}</span><span class="muted">${TEXT.changelogNote}</span></div><div class="changelog-body" data-changelog></div></section>
					<section class="card settings" hidden><div class="card-head"><span class="title">${TEXT.settings}</span></div>
						<section class="settings-box"><div class="settings-group">${TEXT.groups.general}</div>
						${settingRow(TEXT.keybind, TEXT.keybindHelp, `<button type="button" class="keybind" data-action="record"></button><button type="button" class="btn" data-action="reset-key">${TEXT.reset}</button>`, ' data-key-help')}
						${settingRow(TEXT.buttonStyle, TEXT.buttonStyleHelp, choice('buttons', TEXT.buttonStyle, TEXT.buttonStyles))}
						${settingRow(TEXT.accent, TEXT.accentHelp, `<span class="swatches" role="radiogroup" aria-label="${TEXT.accent}">${swatches}<input type="color" tabindex="-1" aria-hidden="true" data-custom-color></span>`)}
						${settingRow(TEXT.genz, TEXT.genzHelp, choice('genz', TEXT.genz, TEXT.oldOptions))}
						${settingRow(TEXT.shareSetting, TEXT.shareSettingHelp, choice('share', TEXT.shareSetting, TEXT.oldOptions))}
						</section>
						<section class="settings-box" data-genz-settings hidden><div class="settings-group">${TEXT.groups.genz}</div>
						<details class="settings-fold"><summary>${TEXT.animations}</summary>
						${TEXT.anims.map(([key, name, help]) => settingRow(name, help, choice(key as keyof Settings, name, TEXT.oldOptions))).join('')}
						${settingRow(TEXT.surpriseOpen, TEXT.surpriseOpenHelp, choice('surpriseOpen', TEXT.surpriseOpen, TEXT.oldOptions))}
						${settingRow(TEXT.surpriseXp, TEXT.surpriseXpHelp, `<input type="text" class="num-field wide" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" aria-label="${TEXT.surpriseXp}" data-number="surpriseXp">`)}
						</details>
						<details class="settings-fold"><summary>${TEXT.soundsTitle}</summary>
						${settingRow(TEXT.muteAll, TEXT.muteAllHelp, choice('muteAll', TEXT.muteAll, TEXT.oldOptions))}
						${settingRow(TEXT.focusOnly, TEXT.focusOnlyHelp, choice('focusOnly', TEXT.focusOnly, TEXT.oldOptions))}
						${settingRow(TEXT.volume, TEXT.volumeHelp, `<span class="volume"><input type="range" min="0" max="100" step="5" aria-label="${TEXT.volume}" data-volume><span class="num" data-volume-value></span></span>`)}
						${TEXT.sounds.map(([key, name, help]) => settingRow(name, help, choice(key as keyof Settings, name, TEXT.oldOptions))).join('')}
						</details>
						</section>
						<section class="settings-box"><div class="settings-group">${TEXT.groups.columns}</div>
						${settingRow(TEXT.skillsAs, TEXT.skillsAsHelp, choice('skillsAs', TEXT.skillsAs, TEXT.skillsAsOptions))}
						${settingRow(TEXT.strainAs, TEXT.strainAsHelp, choice('strainAs', TEXT.strainAs, TEXT.strainAsOptions))}
						</section>
						<section class="settings-box"><div class="settings-group">${TEXT.groups.recent}</div>
						${settingRow(TEXT.recent, TEXT.recentHelp, choice('recent', TEXT.recent, TEXT.recentOptions))}
						${settingRow(TEXT.recentFor, TEXT.recentForHelp, `<span class="recent-for"><input type="text" class="num-field" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" aria-label="${TEXT.recentFor}" data-number="recentFor">${choice('recentUnit', TEXT.recentFor, TEXT.recentUnits)}</span>`)}
						${settingRow(TEXT.recentCount, TEXT.recentCountHelp, `<input type="text" class="num-field" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" aria-label="${TEXT.recentCount}" data-number="recentCount">`)}
						${settingRow(TEXT.avgOfRecent, TEXT.avgOfRecentHelp, `<input type="text" class="num-field" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" aria-label="${TEXT.avgOfRecent}" data-number="avgOfRecent">`)}
						</section>
						<section class="settings-box"><div class="settings-group">${TEXT.groups.best}</div>
						${settingRow(TEXT.bestCount, TEXT.bestCountHelp, `<input type="text" class="num-field" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" aria-label="${TEXT.bestCount}" data-number="bestCount">`)}
						${settingRow(TEXT.avgOf, TEXT.avgOfHelp, `<input type="text" class="num-field" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" aria-label="${TEXT.avgOf}" data-number="avgOf">`)}
						${settingRow(TEXT.outdateLevel, TEXT.outdateLevelHelp, choice('outdateLevel', TEXT.outdateLevel, TEXT.oldOptions))}
						${settingRow(TEXT.outdatePrestige, TEXT.outdatePrestigeHelp, choice('outdatePrestige', TEXT.outdatePrestige, TEXT.oldOptions))}
						${settingRow(TEXT.oldPlays, TEXT.oldPlaysHelp, `<span class="recent-for">${choice('oldOn', TEXT.oldPlays, TEXT.oldOptions)}<input type="text" class="num-field" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" aria-label="${TEXT.oldPlays}" data-number="oldFor">${choice('oldUnit', TEXT.oldPlays, TEXT.recentUnits)}</span>`)}
							<section class="settings-box"><div class="settings-group">${TEXT.groups.strain}</div>
						${settingRow(TEXT.strainFor, TEXT.strainForHelp, `<span class="recent-for"><input type="text" class="num-field" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" aria-label="${TEXT.strainFor}" data-number="strainFor">${choice('strainUnit', TEXT.strainFor, TEXT.recentUnits)}</span>`)}
						</section>
					</section>
					</section>
				</div>
			</div>`;
		document.body.appendChild(host);
		this.own(() => host.remove());
		// while open (only then, so the game's menus and chat work when it's closed): keys typed and the wheel turned in
		// the window stay in it, and the game doesn't take focus from it
		let guards: (() => void)[] = [];
		const guard = (on: boolean) => {
			for (const off of guards) off();
			guards = on ? [isolateInput(host), keepFocus(host)] : [];
		};
		this.own(() => guard(false));
		this.own(() => this.hotkeys.dispose());

		const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
		const win = $('.window'), playsList = $('[data-list="plays"]'), bestList = $('[data-list="best"]'), recentList = $('[data-list="recent"]'), skillsList = $('[data-list="skills"]'), sharedList = $('[data-list="shared"]'), count = $('[data-count]');
		const keyButton = $('[data-action="record"]'), keyHelp = $('[data-key-help]'), gear = $('[data-action="settings"]'), bug = $('[data-action="debug"]'), news = $('[data-action="changelog"]');
		const customColor = $<HTMLInputElement>('[data-custom-color]');
		const gameVersion = gameHost()?.version || buildMeta().gameVersion;
		$('[data-versions]').textContent = TEXT.versions(this.meta.version ?? buildMeta().version ?? "", gameVersion);
		const numbers = [...root.querySelectorAll<HTMLInputElement>('[data-number]')];
		const volume = $<HTMLInputElement>('[data-volume]');
		const genz = createGenZ(root, win, () => {
			const s = this.settings, on = (v: string) => v === 'on';
			return { on: on(s.genz), volume: s.volume, mute: on(s.muteAll), focusOnly: on(s.focusOnly), sounds: { click: on(s.soundClick), tab: on(s.soundTab), open: on(s.soundOpen), play: on(s.soundPlay), best: on(s.soundBest), ticks: on(s.soundTicks), flash: on(s.soundFlash), copy: on(s.soundCopy), surprise: on(s.soundSurprise), horn: on(s.soundHorn) },
				anims: { buttons: on(s.animButtons), switches: on(s.animSwitches), window: on(s.animWindow), pages: on(s.animPages), flash: on(s.animFlash), bars: on(s.animBars), plays: on(s.animPlays), rows: on(s.animRows), confetti: on(s.animConfetti) } };
		});
		this.own(() => genz.dispose());

		/** Whether ADHD Mode was on when Settings was last opened. */
		let genzSettingsShown = this.settings.genz === 'on';
		// the settings that change how the window looks, applied all at once
		const applyLook = () => {
			const s = this.settings, accent = accentOf(s);
			win.dataset.buttons = s.buttons;
			win.style.setProperty('--accent', accent);
			win.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 12%, transparent)`);
			win.style.setProperty('--on-accent', onAccent(accent));
			for (const b of root.querySelectorAll<HTMLElement>('[data-set]')) b.setAttribute('aria-checked', String(String(s[b.dataset.set as keyof Settings]) === b.dataset.value));
			for (const b of root.querySelectorAll<HTMLElement>('[data-accent]')) b.setAttribute('aria-checked', String(b.dataset.accent === s.accent));
			// shown (true), its main-skill maps hidden (mixed), every map it's a top skill of hidden (false)
			for (const b of root.querySelectorAll<HTMLElement>('[data-skill]')) {
				const sk = b.dataset.skill!;
				b.setAttribute('aria-pressed', s.removed.includes(sk) ? 'false' : s.hidden.includes(sk) ? 'mixed' : 'true');
				b.classList.toggle('focus', s.focused.includes(sk));
			}
			$('.legend-list').classList.toggle('focusing', s.focused.length > 0);
			$('.swatches .custom').style.background = s.accent === 'custom' ? s.customAccent : '';
			$('[data-action="advanced"]').setAttribute('aria-pressed', String(s.advanced === 'on'));
			customColor.value = s.customAccent;
			for (const input of numbers) input.value = String(s[input.dataset.number as typeof NUMBER_SETTINGS[number]]);
			for (const input of root.querySelectorAll<HTMLInputElement>('[data-at]')) {
				const v = s[input.dataset.at as 'atCount' | 'atMin' | 'atMax'];
				input.value = input.dataset.at === 'atMax' && !v ? '' : String(v);
			}
			$('[data-best-note]').textContent = $('[data-recent-note]').textContent = TEXT.bestNote[s.unit] ?? '';
			$('[data-recent-title]').textContent = TEXT.recentTitle(s.recentFor, s.recentUnit);
			// ADHD Mode's own settings only while it's on, and only from the next time Settings is opened after turning
			// it on; the time tags only in Advanced mode
			$('[data-genz-settings]').hidden = s.genz !== 'on' || !genzSettingsShown;
			volume.value = String(s.volume);
			$('[data-volume-value]').textContent = `${s.volume}%`;
			for (const el of root.querySelectorAll<HTMLElement>('[data-advanced-only]')) el.hidden = s.advanced !== 'on';
			genz.apply();
		};

		let plays: Play[] | null = null;
		/** Effective Maps shows All Time Highest instead (its button), from its own read of every play (null: the
		 *  database couldn't, so the newest plays are used). Read again after new plays, showing the last read till then. */
		let allTime = false;
		let ever: Play[] | null = null, everStale = true;
		/** The maps All Time Highest shows, best first: what its playlist is saved from. */
		let everShown: BestEver[] = [];
		const readEver = async () => {
			ever = await allTime7k().catch(() => null);
			if (allTime && page === 'best') renderLists();
		};
		/** ADHD Mode's accuracy surprise: once per map, ever, for a play since the last look (or since the game started)
		 *  that gave the map more accuracy XP than the setting, and only if it's news: a map that already gave that
		 *  before (any older play read) is known, and never surprises. Moves the last look on. */
		let surpriseSince = Date.now();
		const surpriseIn = (list: Play[]) => {
			const s = this.settings, wanted = s.genz === 'on' && (s.animConfetti === 'on' || s.soundSurprise === 'on' || s.soundHorn === 'on');
			const gives = (p: Play) => num(p.gains.accuracy) > s.surpriseXp;
			// the oldest such play of each map: a map whose first one is from before the last look is known already
			const first = new Map<number, number>();
			for (const p of list) if (gives(p)) first.set(p.beatmapId, Math.min(first.get(p.beatmapId) ?? Infinity, p.playedAt));
			for (const [map, at] of first) if (at <= surpriseSince && !surprised().has(map)) noteSurprise(map);
			const found = wanted ? list.find((p) => p.playedAt > surpriseSince && gives(p) && first.get(p.beatmapId) === p.playedAt && !surprised().has(p.beatmapId)) : undefined;
			surpriseSince = Math.max(surpriseSince, ...list.map((p) => p.playedAt));
			return found;
		};
		/** While the lists are drawn after new plays were read. */
		let newPlays = false;
		/** A map whose recent plays alone are shown in Recent plays, or 0 for all. */
		let only = 0;
		/** What's typed in the search box; every list shows only what fits it. */
		let query: Search = parseSearch('');
		const keepPlay = () => (searching(query) ? (p: Play) => playedIn(query, p.playedAt) && fitsSearch(query, p.info, p.beatmapId, p.rate, p.gains) : undefined);
		const keepMaps = <T extends { info: Play['info'], beatmapId: number, rate: number, gains: Play['gains'] }>(maps: T[]) =>
			(searching(query) ? maps.filter((m) => fitsSearch(query, m.info, m.beatmapId, m.rate, m.gains)) : maps);
		/** Most effective maps and the recent list leave out maps whose main skill is hidden in the Skills box, and maps
		 *  with a removed skill among their top 2. */
		const shownSkills = <T extends { gains: Play['gains'] }>(maps: T[]) => {
			const { hidden, removed, focused } = this.settings;
			if (!hidden.length && !removed.length && !focused.length) return maps;
			// focused skills: only maps one of them is a top skill of; then the hidden ones as before
			return maps.filter((m) => (!focused.length || topSkills(m.gains).some((sk) => focused.includes(sk)))
				&& !hidden.includes(mainSkill(m.gains)) && !topSkills(m.gains).some((sk) => removed.includes(sk)));
		};
		/** Recent plays are drawn 50 at a time; scrolling near the end adds the next 50. */
		let playsShown = PLAYS_BATCH;
		/** The tabs drawn from the current plays; the others are drawn when they're opened. */
		let drawn = new Set<Page>();
		const renderLists = () => {
			drawn = new Set();
			drawPage();
		};
		const drawPage = () => {
			if (page === 'suggest') { drawSuggest(); return; }
			if (!plays || TOOL_PAGES.includes(page) || drawn.has(page)) return;
			drawn.add(page);
			const lists = page === 'plays' ? [playsList] : page === 'best' ? [bestList, recentList] : page === 'shared' ? [sharedList] : [skillsList];
			// what's open stays open when a list is drawn again
			// (per list: the same map can be in two lists, and opening it in one mustn't open the other)
			const keyOf = (el: HTMLElement) => `${el.closest<HTMLElement>('[data-list]')?.dataset.list}:${el.dataset.key}`;
			const open = new Set(lists.flatMap((l) => [...l.querySelectorAll<HTMLElement>('[aria-expanded="true"], details[open]')]).map(keyOf));
			const s = this.settings, now = Date.now(), since = now - recentMs(s), title = TEXT.recentTitle(s.recentFor, s.recentUnit);
			// Effective Maps, the recent list and Skills use only the plays inside the searched time (day, ts, te)
			const timed = query.time ? plays.filter((p) => playedIn(query, p.playedAt)) : plays;
			const outdateBy = { level: s.outdateLevel === 'on', prestige: s.outdatePrestige === 'on' };
			showStrainAs(s.strainAs);
			if (page === 'plays') {
				playsList.innerHTML = playsHtml(plays, now, s.unit, s.skillsAs, since, TEXT.stale(title), only, searching(query) ? TEXT.noMatch : only ? TEXT.noMapPlays(title) : TEXT.noPlays, 0, playsShown, keepPlay());
				const listed = listedPlays(plays, since, only, keepPlay());
				count.textContent = listed.length ? `· ${listed.length}` : '';
				const info = only ? plays.find((p) => p.beatmapId === only)?.info : undefined;
				$('[data-filter-name]').textContent = only ? `${info ? info.title : TEXT.map(only)} · ${title}` : '';
				$('[data-filter]').hidden = !only;
			} else if (page === 'best') {
				// with old plays left out, only the newer ones count (a map played only before then drops out)
				const kept = s.oldOn === 'on' ? timed.filter((p) => p.playedAt >= now - oldMs(s)) : timed;
				const none = searching(query) ? TEXT.noMatch : undefined;
				// a map's latest play against its top skills (15% of its XP or more): a prestige outdates it (ranked after
				// the others), a level up warns
				const out = (m: MapStats) => {
					const why = topSkills(m.last).map((sk) => outdatedFor(levelHistory(), sk, m.lastAt, outdateBy));
					return why.includes('prestige') ? 'prestige' : why.includes('level') ? 'level' : '';
				};
				const ranked = shownSkills(keepMaps(bestMaps(kept, s.avgOf)));
				const best = [...ranked.filter((m) => out(m) !== 'prestige'), ...ranked.filter((m) => out(m) === 'prestige')].slice(0, s.bestCount);
				if (allTime) {
					// All Time Highest: every play (searched, skills shown), each map's best ever
					if (everStale) { everStale = false; void readEver(); }
					const from = ever ?? plays;
					everShown = allTimeBest(keepPlay() ? from.filter(keepPlay()!) : from).filter((m) => shownSkills([m]).length).slice(0, ALL_TIME_COUNT);
					bestList.innerHTML = allTimeHtml(everShown, s.unit, s.skillsAs, none);
				} else bestList.innerHTML = bestHtml(best, s.unit, s.skillsAs, since, TEXT.stale(title), none, true, undefined, false, undefined, out);
				// the recent list counts only the plays inside the time, coloured as Effective Maps colours them
				recentList.innerHTML = bestHtml(shownSkills(keepMaps(bestMaps(timed.filter((p) => p.playedAt >= since), s.avgOfRecent || Infinity))).slice(0, s.recentCount), s.unit, s.skillsAs, 0, '', none ?? TEXT.noRecent(title), true, undefined, false, gradeScale(best.filter((m) => out(m) !== 'prestige'), since));
			} else if (page === 'shared') {
				drawShared();
			} else {
				skillsList.innerHTML = bySkillHtml(keepMaps(bestMaps(s.oldOn === 'on' ? timed.filter((p) => p.playedAt >= now - oldMs(s)) : timed, s.avgOf)), s.unit, since, TEXT.stale(title),
					// a skill with no maps left after old plays are left out shows grayed out (not while searching)
					s.oldOn === 'on' && !searching(query) ? TEXT.noSkillPlays(TEXT.recentTitle(s.oldFor, s.oldUnit)) : '',
					(m, skill) => outdatedFor(levelHistory(), skill, m.lastAt, outdateBy));
			}
			for (const list of lists) genz.drawn(list, newPlays);
			this.drawnAt = now;
			if (!open.size) return;
			for (const list of lists) {
				for (const el of list.querySelectorAll<HTMLElement>('[data-key]')) {
					if (!open.has(keyOf(el))) continue;
					if (el instanceof HTMLDetailsElement) { el.open = true; continue; }
					el.setAttribute('aria-expanded', 'true');
					(el.nextElementSibling as HTMLElement).hidden = false;
				}
			}
		};
		// Strain: picked when Suggest is pressed, kept (and drawn again for the unit) until it's pressed again
		type Group = { maps: (MapStats & { repeat?: number })[], v: Map<MapStats, number>, note?: string };
		let suggested: Partial<Record<'warm' | 'cool' | 'peak', Group>> | undefined;
		/** Each map's strain: the median change of its noted plays at that rate, leaving out ones the game can't give
		 *  (from before 0.1.38 counted rest correctly). Maps without one are left out. */
		const strainOfMaps = (from: Play[]) => {
			const v = new Map<MapStats, number>();
			for (const m of shownSkills(keepMaps(bestMaps(from, this.settings.avgOf)))) {
				const vs = from.filter((p) => p.beatmapId === m.beatmapId && p.rate === m.rate).map((p) => strainOf(p.playedAt)?.v)
					.filter((x): x is number => x !== undefined && x >= -1 && x <= 3).sort((a, b) => a - b);
				if (vs.length) v.set(m, (vs[(vs.length - 1) >> 1]! + vs[vs.length >> 1]!) / 2);
			}
			return v;
		};
		const pickSuggest = async () => {
			if (!plays) return;
			// the plays in the Strain time (your skills now); mindblock still counts the whole last day
			const all = plays, from = all.filter((p) => p.playedAt >= Date.now() - strainMs(this.settings));
			const title = TEXT.recentTitle(this.settings.strainFor, this.settings.strainUnit);
			if (this.settings.strainMode === 'max') {
				// Max strain: the maps that strain or rest you the most (3 arrows), most XP per minute first
				const v = strainOfMaps(from);
				const group = (way: 1 | -1): Group => ({ maps: [...v.keys()].filter((m) => arrowsOf(v.get(m)!) * way >= 3).slice(0, SUGGEST_COUNT), v });
				suggested = { warm: group(1), cool: group(-1) };
			} else {
				// To Peak: the plays that take you to Peak's nearest edge
				const v = strainOfMaps(from);
				const now = await strainNow();
				let note = TEXT.peakNoStrain, maps: Group['maps'] = [];
				if (now) {
					const [start, end] = peakMinutes(now.upgrades), bar = Math.round(strainBar(now.minutes, now.upgrades) * 100);
					const target = now.minutes > end ? end : now.minutes < start ? start : now.minutes;
					// mindblock counts the map's plays in your last 50 within a day
					const day = all.filter((p) => p.playedAt >= Date.now() - 24 * 3600e3).slice(0, 50);
					const byKey = new Map([...v.keys()].map((m) => [`${m.beatmapId}@${m.rate}`, m]));
					const pool: PeakMap[] = [...v.keys()].map((m) => {
						const total = Object.values(m.gains).reduce((a: number, x) => a + (Number(x) || 0), 0) || 1;
						const free = MINDBLOCK_FREE.reduce((a, sk) => a + (Number(m.gains[sk]) || 0), 0) / total;
						const lengthMin = m.info && m.info.lengthSec > 0 ? m.info.lengthSec / m.rate / 60 : 0;
						return { key: `${m.beatmapId}@${m.rate}`, beatmapId: m.beatmapId, lengthMin, change: v.get(m)!, free: m.perMinute * free, blocked: m.perMinute * (1 - free), recent: day.filter((p) => p.beatmapId === m.beatmapId).length };
					});
					const plan = planToPeak(now.minutes, target, pool);
					maps = plan.steps.map((st) => ({ ...byKey.get(st.key)!, repeat: st.count, n: st.count }));
					note = target === now.minutes ? TEXT.peakIn(bar)
						: !plan.steps.length ? TEXT.peakNoMaps(title)
						: plan.reached ? TEXT.peakPlan(bar, target < now.minutes ? 'cool' : 'warm', plan.plays, Math.round(plan.minutes))
						: TEXT.peakShort(plan.plays, title);
				}
				suggested = { peak: { maps, v, note } };
			}
			drawSuggest(true);
		};
		const drawSuggest = (fresh = false) => {
			if (!suggested) return;
			const s = this.settings;
			$('[data-suggest]').innerHTML = (['warm', 'cool', 'peak'] as const).filter((g) => suggested![g]).map((g) => {
				const { maps, v, note } = suggested![g]!;
				return `<section class="suggest-group"><div class="suggest-head"><span class="strong">${TEXT.suggestGroups[g]}</span>${maps.length ? `<button type="button" class="btn small" data-action="save-playlist" data-group="${g}" title="${TEXT.savePlaylistStrainHelp}">${TEXT.savePlaylist}</button>` : ''}</div>
					${note ? `<div class="suggest-note">${esc(note)}</div>` : ''}
					${maps.length || !note ? `<div class="list best" data-list="suggest-${g}">${bestHtml(maps, s.unit, s.skillsAs, 0, '', TEXT.noSuggest(TEXT.recentTitle(s.strainFor, s.strainUnit)), true, (m) => v.get(m), true)}</div>` : ''}</section>`;
			}).join('');
			// ADHD Mode: a new pick flashes and grows again
			const lists = [...root.querySelectorAll<HTMLElement>('[data-suggest] [data-list]')];
			for (const list of lists) genz.added(list, fresh);
		};

		// the recent list into the game playlist; the button says how it went for a moment
		// a Strain group's button saves that group (`data-group`); the recent list's saves the recent list
		const savePlaylistNow = async (button: HTMLElement) => {
			if (!plays || button.dataset.busy) return;
			button.dataset.busy = '1';
			const s = this.settings, since = Date.now() - recentMs(s), group = button.dataset.group as 'cool' | 'warm' | 'peak' | undefined;
			const maps = group ? suggested?.[group]?.maps ?? []
				: shownSkills(bestMaps(plays.filter((p) => p.playedAt >= since), s.avgOfRecent || Infinity)).slice(0, s.recentCount);
			const title = group ? TEXT.suggestGroups[group]! : TEXT.recentTitle(s.recentFor, s.recentUnit);
			const name = group ? TEXT.playlistStrainName(title) : TEXT.playlistName(title);
			const oldNames = group ? TEXT.oldPlaylistNames.strain(title) : TEXT.oldPlaylistNames.recent(title);
			let text = TEXT.saved;
			try {
				if (!maps.length) throw new Error('no maps');
				await savePlaylist(name, maps, oldNames);
			} catch (e) {
				this.log.error('saving the playlist failed', e);
				text = TEXT.saveFailed;
			}
			button.textContent = text;
			window.setTimeout(() => { button.textContent = TEXT.savePlaylist; delete button.dataset.busy; }, 2000);
		};

		// All Time Highest's playlist: up to Maps of its maps, best first, whose XP per time (in the unit shown) is
		// between Min XP and Max XP (no Max XP: no limit)
		const saveAllTime = async (button: HTMLElement) => {
			if (button.dataset.busy) return;
			button.dataset.busy = '1';
			const s = this.settings, per = PER_MINUTE[s.unit];
			const maps = everShown.filter((m) => m.perMinute * per >= s.atMin && (!s.atMax || m.perMinute * per <= s.atMax)).slice(0, s.atCount);
			let text = TEXT.saved;
			try {
				if (!maps.length) text = TEXT.noMapsInRange;
				else await savePlaylist(TEXT.allTimePlaylist, maps, TEXT.oldPlaylistNames.allTime);
			} catch (e) {
				this.log.error('saving the playlist failed', e);
				text = TEXT.saveFailed;
			}
			button.textContent = text;
			window.setTimeout(() => { button.textContent = TEXT.savePlaylist; delete button.dataset.busy; }, 2000);
		};
		// its fields: whole numbers, saved as they're left (Min XP emptied: 0; Max XP empty: no limit); one that can't be
		// read goes back
		for (const input of root.querySelectorAll<HTMLInputElement>('[data-at]')) {
			const key = input.dataset.at as 'atCount' | 'atMin' | 'atMax';
			this.on(input, 'input', () => { input.value = input.value.replace(/\D/g, ''); });
			this.on(input, 'keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') input.blur(); else deleteKeys(input, event as KeyboardEvent); });
			this.on(input, 'change', () => {
				const n = key !== 'atCount' && input.value === '' ? 0 : wholeOf(input.value, key === 'atCount' ? 1 : 0, key === 'atCount' ? ALL_TIME_COUNT : 99999999);
				if (n !== null) this.save({ [key]: n });
				applyLook();
			});
		}

		// near the end of Recent plays: the next 50 (only while scrolling, nothing runs otherwise)
		this.on(playsList, 'scroll', () => {
			if (!plays || page !== 'plays' || playsList.scrollTop + playsList.clientHeight < playsList.scrollHeight - 300) return;
			const s = this.settings, since = Date.now() - recentMs(s);
			if (playsShown >= listedPlays(plays, since, only, keepPlay()).length) return;
			const title = TEXT.recentTitle(s.recentFor, s.recentUnit);
			showStrainAs(s.strainAs);
			playsList.insertAdjacentHTML('beforeend', playsHtml(plays, Date.now(), s.unit, s.skillsAs, since, TEXT.stale(title), only, '', playsShown, PLAYS_BATCH, keepPlay()));
			playsShown += PLAYS_BATCH;
			genz.added(playsList);
		});

		const stopRecording = () => {
			this.recording = false;
			keyButton.classList.remove('recording');
			keyButton.textContent = hotkeyLabel(this.settings.hotkey);
			keyHelp.textContent = TEXT.keybindHelp;
		};

		let page: Page = this.settings.view;
		// ---- Shared: the table (kept on this computer, fetched again once it's an hour old), drawn like All Time Highest
		let sharedState: { table: SharedTable | null, infos: Record<number, MapInfo | undefined>, loading: boolean } = { table: sharedTable(), infos: {}, loading: false };
		const loadShared = async (force = false) => {
			if (sharedState.loading) return;
			sharedState.loading = true;
			try {
				const table = await fetchTable(force);
				sharedState = { table, infos: table ? await sharedInfos(table) : {}, loading: false };
			} finally { sharedState.loading = false; }
			if (page === 'shared') renderLists();
		};
		// Shared draws its first 50 songs, and the next 50 as you scroll near the end (as Recent plays does)
		let sharedSongsList: SharedSong[] = [], sharedShown = PLAYS_BATCH;
		this.on(sharedList, 'scroll', () => {
			if (page !== 'shared' || sharedShown >= sharedSongsList.length || sharedList.scrollTop + sharedList.clientHeight < sharedList.scrollHeight - 300) return;
			const s = this.settings;
			sharedList.insertAdjacentHTML('beforeend', sharedHtml(sharedSongsList, s.unit, s.skillsAs, '', sharedShown, PLAYS_BATCH));
			sharedShown += PLAYS_BATCH;
			genz.added(sharedList);
		});
		const drawShared = () => {
			const s = this.settings, { table, infos } = sharedState, status = $('[data-shared-status]');
			if (!table) { sharedList.innerHTML = messageHtml(sharedState.loading ? TEXT.sharedLoading : TEXT.sharedOffline, !sharedState.loading); status.textContent = ''; return; }
			// your own XP per minute at each map and rate (your latest play there)
			const yours = new Map((plays ? bestMaps(plays, 1) : []).map((m) => [`${m.beatmapId}@${m.rate}`, m.perMinute]));
			const rows: SharedRow[] = table.maps.map((m) => ({ ...m, info: infos[m.map], you: yours.get(`${m.map}@${m.rate}`) ?? 0, mapPlayers: m.mapPlayers ?? m.players }))
				.filter((m) => !searching(query) || fitsSearch(query, m.info, m.map, m.rate, m.base));
			// songs, their difficulties, each difficulty's rates (the Skills box's focus and hiding go by each rate's skills)
			const songs = sharedSongs(shownSkills(rows.map((r) => ({ ...r, gains: r.base }))));
			sharedSongsList = songs;
			sharedList.innerHTML = sharedHtml(songs, s.unit, s.skillsAs, searching(query) ? TEXT.noMatch : TEXT.sharedNone, 0, sharedShown);
			status.textContent = TEXT.sharedUpdated(agoText(Date.now() - table.fetched), songs.length);
			showPool();
		};
		// a batch reaching Shared: a note at the bottom of the window for a moment
		const showSent = (n: number) => {
			const note = document.createElement('div');
			note.className = 'sent-note';
			note.textContent = TEXT.sharedSent(n);
			win.append(note);
			window.setTimeout(() => { note.classList.add('out'); window.setTimeout(() => note.remove(), 250); }, 3500);
		};
		// the warning, in the middle of the window over the Shared tab until answered
		win.insertAdjacentHTML('beforeend', `<div class="share-veil" hidden><section class="card share-ask" role="dialog" aria-label="${TEXT.shareTitle}"><div class="card-head"><span class="title">${TEXT.shareTitle}</span></div>
			<div class="lead">${TEXT.shareLead}</div>
			<div class="cols"><div><h4>${TEXT.shareSentTitle}</h4><ul>${TEXT.shareSent.map((t) => `<li>${t}</li>`).join('')}</ul></div>
			<div><h4>${TEXT.shareNeverTitle}</h4><ul>${TEXT.shareNever.map((t) => `<li>${t}</li>`).join('')}</ul><h4 class="next">${TEXT.shareKnowTitle}</h4><ul>${TEXT.shareKnow.map((t) => `<li>${t}</li>`).join('')}</ul></div></div>
			<textarea class="sample dbg-text" readonly spellcheck="false" hidden></textarea>
			<div class="foot"><button type="button" class="link" data-action="share-show">${TEXT.shareShow}</button><span class="muted">${TEXT.shareLater}</span><button type="button" class="btn" data-action="share-no">${TEXT.shareDisagree}</button><button type="button" class="btn" data-action="share-yes">${TEXT.shareAgree}</button></div></section></div>`);
		// ---- Make a Playlist: maps picked from Shared (right-click a map while it's open), saved as one game playlist
		let picked: { map: number, rate: number, repeat: number }[] | null = null;
		win.insertAdjacentHTML('beforeend', `<section class="pick-pop" role="dialog" aria-label="${TEXT.pickTitle}" hidden><div class="head"><span class="title">${TEXT.pickTitle} - <span data-pick-preview>${esc(TEXT.pickName(''))}</span></span><span class="muted" data-pick-count></span></div><div class="pick-list" data-pick-list></div>
			<div class="foot"><button type="button" class="btn small" data-action="pick-close">${TEXT.close}</button><input type="text" class="num-field" maxlength="40" autocomplete="off" spellcheck="false" placeholder="${TEXT.pickNamePlaceholder}" data-pick-name><button type="button" class="btn small" data-action="pick-create">${TEXT.pickCreate}</button></div></section>
			<div class="pick-menu" role="menu" hidden></div>`);
		const pickPop = $('.pick-pop'), pickMenu = $('.pick-menu');
		const pickLabel = (map: number) => {
			const i = sharedState.infos[map];
			return i ? `${i.title}${i.difficulty ? ` · ${i.difficulty}` : ''}` : TEXT.map(map);
		};
		const drawPicked = () => {
			pickPop.hidden = !picked;
			if (!picked) return;
			$('[data-pick-count]').textContent = picked.length ? TEXT.pickCount(picked.length) : TEXT.pickHint;
			$('[data-pick-list]').innerHTML = picked.map((m, i) => `<div class="item"><span class="name">${esc(pickLabel(m.map))}</span><span class="muted">${m.rate}</span><span class="repeat"><span class="muted">×</span><input type="text" class="num-field" inputmode="numeric" maxlength="2" autocomplete="off" spellcheck="false" aria-label="${TEXT.pickRepeat}" value="${m.repeat}" data-pick-repeat="${i}"></span><button type="button" class="close" data-action="pick-remove" data-i="${i}" aria-label="${TEXT.pickRemove}" title="${TEXT.pickRemove}">✕</button></div>`).join('');
		};
		// the playlist's name as it will be saved, shown in the window's title as it's typed
		const pickName = $<HTMLInputElement>('[data-pick-name]');
		const showPickName = () => { $('[data-pick-preview]').textContent = TEXT.pickName(pickName.value.trim()); };
		this.on(pickName, 'input', showPickName);
		// how many times each map plays: 1 to 99 (anything else counts as 1, and shows so once you leave the box)
		this.on(pickPop, 'input', ((e: Event) => {
			const box = e.target as HTMLInputElement, i = box.dataset.pickRepeat;
			if (i === undefined || !picked?.[Number(i)]) return;
			box.value = box.value.replace(/\D/g, '');
			picked[Number(i)]!.repeat = Math.min(99, Math.max(1, Number(box.value) || 1));
		}) as EventListener);
		this.on(pickPop, 'focusout', ((e: Event) => {
			const box = e.target as HTMLInputElement, i = box.dataset.pickRepeat;
			if (i !== undefined && picked?.[Number(i)]) box.value = String(picked[Number(i)]!.repeat);
		}) as EventListener);
		const closePickMenu = () => { pickMenu.hidden = true; };
		// a map's menu: at 1.0, and at its own rate when that isn't 1.0
		this.on(sharedList, 'contextmenu', ((e: MouseEvent) => {
			const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
			if (!picked || !rowEl) return;
			e.preventDefault();
			const [map, rate] = (rowEl.dataset.pick ?? '').split('@').map(Number) as [number, number];
			pickMenu.innerHTML = `<button type="button" role="menuitem" data-action="pick-add" data-map="${map}" data-rate="1">${TEXT.pickAdd}</button>${rate !== 1 ? `<button type="button" role="menuitem" data-action="pick-add" data-map="${map}" data-rate="${rate}">${esc(TEXT.pickAddRate(rate))}</button>` : ''}`;
			pickMenu.hidden = false;
			const box = win.getBoundingClientRect();
			pickMenu.style.left = `${Math.min(e.clientX - box.left, box.width - pickMenu.offsetWidth - 8)}px`;
			pickMenu.style.top = `${Math.min(e.clientY - box.top, box.height - pickMenu.offsetHeight - 8)}px`;
		}) as EventListener);
		this.on(sharedList, 'scroll', closePickMenu);
		this.on(win, 'click', ((e: MouseEvent) => { if (!pickMenu.contains(e.target as Node)) closePickMenu(); }) as EventListener);
		const createPicked = async (button: HTMLElement) => {
			if (!picked || button.dataset.busy) return;
			const done = (text: string, close: boolean) => {
				button.textContent = text;
				button.dataset.busy = '1';
				window.setTimeout(() => {
					button.textContent = TEXT.pickCreate;
					delete button.dataset.busy;
					if (close) { picked = null; pickName.value = ''; showPickName(); drawPicked(); }
				}, close ? 1000 : 2000);
			};
			if (!picked.length) { done(TEXT.pickEmpty, false); return; }
			try {
				await savePlaylist(TEXT.pickName(pickName.value.trim()), picked.map((m) => ({ beatmapId: m.map, rate: m.rate, repeat: m.repeat })));
				done(TEXT.saved, true);
			} catch (e) {
				this.log.error('saving the playlist failed', e);
				done(TEXT.saveFailed, false);
			}
		};
		/** What one play looks like when sent: the newest play with a base XP, or an example. */
		const shareSample = () => {
			const b = plays ? basePlays(plays).find((x) => 'base' in x) : undefined;
			const p = b?.play;
			return JSON.stringify({ player: 'a random ID made on this computer', game: gameVersion ?? '', map: p?.beatmapId ?? 1000001910, rate: p?.rate ?? 1, mods: p?.mods ?? '', levels: '(your skill levels then)', acc: p?.acc ?? 0.96, misses: p?.misses ?? 3, len: p?.info?.lengthSec ?? 150, base: b && 'base' in b ? b.base : { ln: 3691.94, focus: 1649.21 }, at: p ? new Date(p.playedAt).toISOString() : '(when it was played)' }, null, 2);
		};
		// your plays waiting to be sent, and a countdown to the next batch: live while the Shared tab shows
		let waiting = 0;
		// the statistics bar: what you shared, the whole pool, and plays shared a minute (over the past hour)
		const shortCount = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${+(n / 1000).toFixed(1)}k` : `${+(n / 1e6).toFixed(1)}M`);
		const showStats = (st: SharedStats | null) => {
			$('[data-stat="you"]').textContent = sentCount().toLocaleString('en-US');
			// short, so the box doesn't clip: 950, 4.7k, 12.3k, 1.2M
			$('[data-stat="pool"]').textContent = st ? shortCount(st.plays) : '–';
			// the exact number on hover
			$('[data-stat="pool"]').parentElement!.title = st ? st.plays.toLocaleString('en-US') : '';
			$('[data-stat="players"]').textContent = st ? st.players.toLocaleString('en-US') : '–';
			// the next batch: what everyone shared in the past 10 minutes
			$('[data-stat="next"]').textContent = st ? st.last10.toLocaleString('en-US') : '–';
			$('[data-stat="rate"]').textContent = st ? (st.lastHour / 60).toFixed(st.lastHour < 600 ? 1 : 0) : '–';
		};
		const refreshStats = () => void fetchStats().then(showStats);
		// your next batch (while sharing): how many plays wait to go, and a countdown to when they go
		const showPool = () => {
			const box = $('[data-next-batch]');
			box.hidden = this.settings.share !== 'on';
			if (box.hidden) return;
			const sec = Math.ceil(Math.max(0, nextSendAt() - Date.now()) / 1000);
			$('[data-stat="next-in"]').textContent = TEXT.statNextIn(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
		};
		// the fetch's countdown: 01:00 in grey until the batch goes, then down to the fetch
		const showFetch = () => {
			const left = fetchIn(Date.now()), sec = left === null ? FETCH_AFTER / 1000 : Math.ceil(left / 1000);
			const box = $('[data-fetch]');
			box.classList.toggle('idle', left === null);
			$('[data-stat="fetch"]').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
		};
		/** Sends what's waiting when a batch is due, then counts what's left (and shows the note). */
		const shareNow = async (list: Play[]) => {
			const n = await sendBatch(list);
			waiting = waitingCount(list);
			if (n && !win.hidden) showSent(n);
			showPool();
			if (n) $('[data-stat="you"]').textContent = sentCount().toLocaleString('en-US');
		};
		// every second while the Shared tab shows: the countdowns, and the table when it's due (at :00, :10, :20…); every
		// 30 seconds there: the numbers; every 10 minutes, open or not: the batch
		this.own(((t) => () => window.clearInterval(t))(window.setInterval(() => {
			if (!win.hidden && page === 'shared') {
				showFetch();
				if (tableDue()) void loadShared();
				if (Date.now() % 30e3 < 1000) refreshStats();
			}
			if (this.settings.share !== 'on') return;
			if (!win.hidden && page === 'shared') showPool();
			if (Date.now() >= nextSendAt()) {
				if (plays && !win.hidden) void shareNow(plays);
				else void recent7k(gameApi()).then((r) => shareNow(r), () => undefined);
			}
		}, 1000)));
		/** A page's lists, top to bottom. */
		const listsOf = (p: Page) => (p === 'plays' ? [playsList] : p === 'best' ? [recentList, bestList] : p === 'skills' ? [skillsList] : p === 'shared' ? [sharedList]
			: p === 'suggest' ? [...root.querySelectorAll<HTMLElement>('[data-suggest] [data-list]')] : []);
		const showPage = (next: Page) => {
			page = next;
			for (const b of root.querySelectorAll<HTMLElement>('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === next));
			$('.plays').hidden = next !== 'plays';
			$('.card.best:not(.recent-best)').hidden = next !== 'best';
			$('.legend').hidden = next !== 'best' && next !== 'shared';
			$('.shared').hidden = next !== 'shared';
			$('.share-veil').hidden = next !== 'shared' || this.settings.share !== 'ask';
			// Make a Playlist belongs to Shared: hidden on the other tabs (what's picked stays)
			pickPop.hidden = next !== 'shared' || !picked;
			closePickMenu();
			if (next === 'shared') { void loadShared(); refreshStats(); }
			// All Time Highest replaces the recent list (the Skills box stays)
			$('.recent-best').hidden = next !== 'best' || this.settings.recent === 'hide' || allTime;
			$('.by-skill').hidden = next !== 'skills';
			$('.suggest').hidden = next !== 'suggest';
			$('.settings').hidden = next !== 'settings';
			$('.debug').hidden = next !== 'debug';
			$('.changelog').hidden = next !== 'changelog';
			$('[data-unit-switch]').hidden = TOOL_PAGES.includes(next);
			$('.search').hidden = next === 'changelog';
			gear.setAttribute('aria-pressed', String(next === 'settings'));
			bug.setAttribute('aria-pressed', String(next === 'debug'));
			news.setAttribute('aria-pressed', String(next === 'changelog'));
			if (next === 'debug') void drawDebug();
			// the changelog doesn't change while the game runs: drawn the first time it's opened
			const log = $('[data-changelog]');
			if (next === 'changelog' && !log.childElementCount) log.innerHTML = changelogHtml(CHANGELOG);
			if (!TOOL_PAGES.includes(next) && next !== this.settings.view) this.save({ view: next as View });
			if (next === 'settings') { genzSettingsShown = this.settings.genz === 'on'; applyLook(); }
			stopRecording();
			drawPage();
			genz.viewShown(listsOf(next));
		};

		// the debug view: a closed box per part; what was open stays open when it's drawn again
		// what each box copies, and the lines of the boxes with a tick per line (API calls, plays) by their key
		let debugParts: [string, unknown][] = [];
		const debugItems = new Map<string, unknown>();
		const debugBody = $('[data-debug]');
		const drawDebug = async () => {
			const body = debugBody;
			const open = new Set([...body.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.key));
			// what's ticked stays ticked when it's drawn again
			const ticked = new Set([...body.querySelectorAll<HTMLInputElement>('[data-pick]:checked')].map((c) => c.dataset.pick));
			let data: Record<string, unknown>;
			// the plays list shows only what fits the search
			const keep = searching(query) ? (info: Play['info'], beatmapId: number, rate: number, gains: Play['gains'], at: number) => playedIn(query, at) && fitsSearch(query, info, beatmapId, rate, gains) : undefined;
			try { data = await debugData(keep); } catch (e) { data = { error: String(e) }; }
			const { plays: list, character, ...rest } = data;
			// each recent play's base XP (Shared), or why it isn't used: a line per play, as Recent Plays
			// (worked out over every play, as mindblock counts the ones before; then only what fits the search)
			const baseRows = plays ? basePlays(plays).filter((b) => !keep || keep(b.play.info, b.play.beatmapId, b.play.rate, b.play.gains, b.play.playedAt)).slice(0, DEBUG_LIST) : [];
			const base = baseRows.map((b) => ({ playedAt: new Date(b.play.playedAt).toISOString(), beatmapId: b.play.beatmapId, map: b.play.info ? `${b.play.info.title} - ${b.play.info.difficulty}` : 'not in the catalogue', rate: b.play.rate, gains: b.play.gains, ...('base' in b ? { base: b.base } : { skip: b.skip }) }));
			const parts: [string, unknown][] = [...Object.entries(rest), ['plays', list], ['base', base], ['settings', this.settings],
				['addon', { version: this.meta.version, character, userAgent: navigator.userAgent, now: new Date().toISOString() }]];
			debugParts = parts;
			debugItems.clear();
			const opened = (key: string) => (open.has(key) ? ' open' : '');
			const box = (key: string, inner: string, i: number) => `<details class="dbg" data-key="${key}"${opened(key)}><summary><span>${esc(TEXT.debugBoxes[key] ?? key)}</span><button type="button" class="btn small" data-action="copy" data-copy="${i}">${TEXT.copy}</button></summary>${inner}</details>`;
			// the JSON as read-only text: selectable and copyable (in a field, as the game takes focus, and with it the
			// selection, from anything that isn't one)
			const textBlock = (v: unknown) => { const t = JSON.stringify(v, null, 2); return `<textarea class="dbg-text" readonly spellcheck="false" rows="${t.split('\n').length}">${esc(t)}</textarea>`; };
			// a time as it reads on this computer
			const local = (ms: unknown) => new Date(Number(ms)).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
			// API calls and plays: one closed line each
			// `extra`: HTML after the line's text (already escaped)
			const line = (key: string, text: string, json: unknown, extra = '') => `<details class="dbg" data-key="${key}"${opened(key)}><summary><span>${esc(text)}${extra}</span></summary>${textBlock(json)}</details>`;
			// a line with its tick
			const pick = (key: string, item: unknown, label: string, html: string) => {
				debugItems.set(key, item);
				return `<div class="dbg-pick"><input type="checkbox" data-pick="${key}" aria-label="${label}"${ticked.has(key) ? ' checked' : ''}>${html}</div>`;
			};
			body.innerHTML = parts.map(([k, v], i) => {
				if (!Array.isArray(v) || (k !== 'plays' && k !== 'api' && k !== 'base')) return box(k, textBlock(v), i);
				const items = (v as Record<string, unknown>[]).map((x, j) => {
					if (k === 'api') {
						const key = `api:${String(x.atMs)}:${v.length - j}`;
						return pick(key, x, TEXT.selectCall, line(key, `${local(x.atMs)}   ${String(x.call)}   ${x.error ? `failed: ${String(x.error)}` : `${String(x.ms)} ms`}`, x));
					}
					// a base XP line reads its play's map from the play itself (its copy keeps the short form)
					const of = k === 'base' ? baseRows[j]!.play : undefined;
					const known = of ? of.info : typeof x.map === 'string' ? undefined : x.map as { title?: string, difficulty?: string, mapper?: string };
					const name = known ? `${known.title ?? ''} - ${known.difficulty ?? ''}` : `#${String(x.beatmapId)}`;
					const at = of ? of.playedAt : x.playedAtMs;
					const key = `${k === 'base' ? 'base' : 'play'}:${String(at)}`;
					return pick(key, x, TEXT.selectPlay, line(key, `${local(at)}   ${name}`, x, known?.mapper ? ` <span class="mapper">${esc(TEXT.mappedBy(known.mapper))}</span>` : ''));
				}).join('');
				// a tick per line and Select all; Copy copies the ticked ones (all when none is ticked)
				const picker = `<div class="dbg-select"><label><input type="checkbox" data-pick-all> ${TEXT.selectAll}</label><span class="muted" data-picked></span></div>`;
				return box(k, items ? `<div class="dbg-list">${picker}${items}</div>` : textBlock([]), i);
			}).join('');
			showPicked();
		};
		// per box: Select all ticked when every line is, half when some are; the count next to it
		const showPicked = () => {
			for (const box of debugBody.querySelectorAll<HTMLElement>('.dbg-list')) {
				const picks = [...box.querySelectorAll<HTMLInputElement>('[data-pick]')], n = picks.filter((c) => c.checked).length;
				const all = box.querySelector<HTMLInputElement>('[data-pick-all]');
				if (all) { all.checked = n > 0 && n === picks.length; all.indeterminate = n > 0 && n < picks.length; }
				const count = box.querySelector('[data-picked]');
				if (count) count.textContent = n ? TEXT.selected(n) : '';
			}
		};
		this.on(debugBody, 'change', (e) => {
			const box = e.target as HTMLInputElement;
			if (box.matches('[data-pick-all]')) for (const c of box.closest('.dbg-list')!.querySelectorAll<HTMLInputElement>('[data-pick]')) c.checked = box.checked;
			showPicked();
		});
		/** A box's part as it's copied: a list with ticked lines copies only those. */
		const copiedPart = (key: string, value: unknown) => {
			const ticked = [...debugBody.querySelectorAll<HTMLInputElement>(`details[data-key="${key}"] [data-pick]:checked`)];
			return ticked.length ? ticked.map((c) => debugItems.get(c.dataset.pick!)) : value;
		};
		const copyDebug = (button: HTMLElement) => {
			const part = debugParts[Number(button.dataset.copy)];
			const text = button.dataset.copy === 'all' ? JSON.stringify(Object.fromEntries(debugParts.map(([k, v]) => [k, copiedPart(k, v)])), null, 2)
				: part ? JSON.stringify(copiedPart(part[0], part[1]), null, 2) : '';
			void navigator.clipboard?.writeText(text).then(() => {
				const was = button.dataset.copy === 'all' ? TEXT.copyAll : TEXT.copy;
				button.textContent = TEXT.copied;
				window.setTimeout(() => { button.textContent = was; }, 1500);
			}, () => undefined);
		};

		const gameApi = () => (this.host as { api?: Api } | undefined)?.api ?? (globalThis as { ossIdle?: { api?: Api } }).ossIdle?.api;
		const load = async () => {
			const ticket = ++this.loading;
			// the first time only: after that, the old lists stay up until the new ones are ready
			if (!plays) playsList.innerHTML = bestList.innerHTML = recentList.innerHTML = skillsList.innerHTML = messageHtml(TEXT.loading);
			try {
				const api = gameApi();
				// the mark first: anything saved while reading shows up on the next check
				this.mark = await latestMark().catch(() => this.mark);
				await noteStrain(api).catch((e: unknown) => this.log.error('noting the strain failed', e));
				const result = await recent7k(api);
				if (ticket !== this.loading) return;
				plays = result;
				// new plays: All Time Highest reads again when it's shown
				everStale = true;
				// compared with what the lists showed: new plays flash (ADHD Mode)
				newPlays = true;
				try { renderLists(); } finally { newPlays = false; }
				// ADHD Mode's accuracy surprise: on a page that can show the map (Recent plays, from the top, when it's on
				// another)
				if (this.settings.share === 'on') void shareNow(result);
				const found = surpriseIn(result);
				// never on Shared: that map's surprise is skipped for good
				if (found && page === 'shared') noteSurprise(found.beatmapId);
				else if (found) {
					if (page !== 'plays' && page !== 'best') { showPage('plays'); playsList.scrollTop = 0; }
					if (genz.surprise(found.beatmapId, TEXT.accuracyFound)) noteSurprise(found.beatmapId);
				}
				if (page === 'debug') void drawDebug();
			} catch (e) {
				if (ticket !== this.loading) return;
				this.log.error('loading failed', e);
				const message = messageHtml(e instanceof TrackerError ? e.message : TEXT.loadFailed, true);
				playsList.innerHTML = bestList.innerHTML = recentList.innerHTML = skillsList.innerHTML = message;
			}
		};

		// Refresh: says it's reading, then counts down the 3 seconds before it can be pressed again
		const refreshNow = async (button: HTMLElement) => {
			if (button.dataset.busy) return;
			button.dataset.busy = '1';
			button.setAttribute('aria-disabled', 'true');
			button.textContent = TEXT.refreshing;
			const until = Date.now() + REFRESH_COOLDOWN;
			await load();
			const tick = () => {
				const left = until - Date.now();
				if (left > 0) {
					button.textContent = TEXT.refreshIn(Math.ceil(left / 1000));
					window.setTimeout(tick, left % 1000 || 1000);
					return;
				}
				button.textContent = TEXT.refresh;
				button.removeAttribute('aria-disabled');
				delete button.dataset.busy;
			};
			tick();
		};

		let wantOpen = false;
		const surpriseWhileClosed = async () => {
			const result = await recent7k(gameApi()).catch(() => null);
			if (!result || !win.hidden) return;
			const due = surpriseIn(result);
			if (!due) return;
			// shown by load() as the window opens: the last look goes back to just before the play
			surpriseSince = due.playedAt - 1;
			showPage('plays');
			playsList.scrollTop = 0;
			setOpen(true);
		};
		const setOpen = (open: boolean) => {
			wantOpen = open;
			// closing: hidden after ADHD Mode's short fade (at once without it)
			if (open) { win.hidden = false; genz.opened(); genz.viewShown(listsOf(page)); const n = takeNote(); if (n) showSent(n); } else genz.closing(() => { if (!wantOpen) win.hidden = true; });
			guard(open);
			// Esc is taken only while the window is open: closed, it's the game's. While recording, it cancels.
			this.escape?.();
			this.escape = open ? this.hotkeys.register('Escape', () => { if (this.recording) stopRecording(); else setOpen(false); }, { allowInText: true }) : undefined;
			if (open) void load();
			else stopRecording();
		};
		// a tiny check every 10 seconds, open or not: when a play or its XP was saved, its strain is noted (the game
		// keeps none per play), and while open the lists are read again
		this.poll = window.setInterval(() => void latestMark().then((m) => {
			if (m && m !== this.mark) {
				if (!win.hidden) return void load();
				this.mark = m;
				void noteStrain(gameApi()).catch((e: unknown) => this.log.error('noting the strain failed', e));
				// closed: a play due the accuracy surprise opens the tracker on Recent plays to show it
				if (this.settings.genz === 'on' && this.settings.surpriseOpen === 'on') void surpriseWhileClosed();
			// the newest play still waits for its strain: check again (the game counts it a little after saving it)
			} else if (strainWaiting()) {
				void noteStrain(gameApi()).then((noted) => { if (noted && !win.hidden) void load(); }, (e: unknown) => this.log.error('noting the strain failed', e));
			// no new play: once a minute, draw again so times, the recent list and gray maps keep up
			} else if (!win.hidden && Date.now() - this.drawnAt >= 60e3) renderLists();
		}, () => undefined), POLL_MS);
		this.own(() => window.clearInterval(this.poll));

		// the shortcut: registered from the setting, and again whenever it changes
		// (matched here, not by the SDK's hotkeys: they go by what a key types, and on a Mac Option changes that, so a
		// shortcut with Alt never opened the window there)
		const onToggleKey = (e: KeyboardEvent) => {
			if (e.repeat || this.recording || !hotkeyMatches(this.settings.hotkey, e)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			setOpen(win.hidden);
		};
		const bindToggle = () => {
			this.toggleKey?.();
			window.addEventListener('keydown', onToggleKey, { capture: true });
			this.toggleKey = () => window.removeEventListener('keydown', onToggleKey, { capture: true });
			keyButton.textContent = hotkeyLabel(this.settings.hotkey);
		};
		bindToggle();
		this.own(() => { this.toggleKey?.(); this.escape?.(); });

		// recording a new shortcut: the next key press with Ctrl or Alt. Taken before anything else sees it.
		this.on(window, 'keydown', ((e: KeyboardEvent) => {
			if (!this.recording || e.key === 'Escape') return;
			e.preventDefault();
			e.stopImmediatePropagation();
			const combo = hotkeyOf(e);
			if (combo === null) return;
			if (combo === 'needs-modifier') { keyHelp.textContent = TEXT.needsModifier; return; }
			this.save({ hotkey: combo });
			stopRecording();
			bindToggle();
		}) as EventListener, { capture: true });

		// a custom accent: shown while it's picked, saved when the picker closes
		this.on(customColor, 'input', () => { this.settings = { ...this.settings, accent: 'custom', customAccent: customColor.value }; applyLook(); });
		// the number settings: saved once it's a whole number from 1 to 999, else put back
		// as you type, a moment after the last key; Recent plays starts again at its first 50
		const searchBox = $<HTMLInputElement>('[data-search]');
		let searchTimer = 0;
		this.on(searchBox, 'input', () => {
			window.clearTimeout(searchTimer);
			searchTimer = window.setTimeout(() => {
				query = parseSearch(searchBox.value, Date.now(), this.settings.advanced === 'on');
				playsShown = sharedShown = PLAYS_BATCH;
				renderLists();
				if (page === 'debug') void drawDebug();
			}, 150);
		});
		this.on(searchBox, 'keydown', (event) => {
			if (!deleteKeys(searchBox, event as KeyboardEvent)) return;
			searchBox.dispatchEvent(new Event('input'));
		});
		this.own(() => window.clearTimeout(searchTimer));
		for (const input of numbers) {
			// clicked into: the whole number is selected, so typing replaces it (Tab selects it on its own). Not on
			// every focus: the game takes focus while you type and gets it handed back, which would select it again
			let selectOnUp = false;
			this.on(input, 'pointerdown', () => { selectOnUp = root.activeElement !== input; });
			this.on(input, 'mouseup', (e) => {
				if (!selectOnUp) return;
				selectOnUp = false;
				e.preventDefault();
				input.select();
			});
			this.on(input, 'input', () => { input.value = input.value.replace(/\D/g, ''); });
			this.on(input, 'keydown', (event) => {
				if ((event as KeyboardEvent).key === 'Enter') { input.blur(); return; }
				deleteKeys(input, event as KeyboardEvent);
			});
			this.on(input, 'change', () => {
				const n = wholeOf(input.value, NUMBER_MIN[input.dataset.number as typeof NUMBER_SETTINGS[number]], NUMBER_MAX[input.dataset.number as typeof NUMBER_SETTINGS[number]]);
				if (n !== null) { this.save({ [input.dataset.number!]: n }); renderLists(); if (input.dataset.number === 'strainFor' && suggested) void pickSuggest(); }
				applyLook();
			});
		}
		// ADHD Mode's volume: saved as it moves, with a tick to hear it
		this.on(volume, 'input', () => {
			this.save({ volume: Number(volume.value) });
			$('[data-volume-value]').textContent = `${this.settings.volume}%`;
			genz.sample();
		});
		this.on(customColor, 'change', () => this.save({ accent: 'custom', customAccent: customColor.value }));

		applyLook();
		showPage(page);

		// dragged by its header (not its buttons); kept on screen
		const head = $('.head');
		this.on(head, 'pointerdown', (e) => {
			const p = e as PointerEvent;
			if (p.button !== 0 || (p.target as Element).closest('button, .search')) return;
			// layout is read once, at the start; moving only sets transform, once a frame
			const box = win.getBoundingClientRect(), dx = p.clientX - box.left, dy = p.clientY - box.top;
			win.style.left = `${box.left}px`; win.style.top = `${box.top}px`; win.style.transform = 'none';
			head.setPointerCapture(p.pointerId);
			let frame = 0, x = 0, y = 0;
			const move = (m: PointerEvent) => {
				x = Math.min(Math.max(m.clientX - dx, 0), innerWidth - box.width) - box.left;
				y = Math.min(Math.max(m.clientY - dy, 0), innerHeight - box.height) - box.top;
				frame ||= requestAnimationFrame(() => { frame = 0; win.style.transform = `translate(${x}px, ${y}px)`; });
			};
			const up = () => {
				cancelAnimationFrame(frame);
				// the move becomes the position, so the next drag starts from it
				win.style.left = `${box.left + x}px`; win.style.top = `${box.top + y}px`; win.style.transform = 'none';
				head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
			};
			head.addEventListener('pointermove', move);
			head.addEventListener('pointerup', up);
			head.addEventListener('pointercancel', up);
		});

		// one listener for the header and settings buttons, one per list for opening a row's breakdown
		const searchPop = $('.search-pop'), searchHelp = $('.search-help');
		const showSearchHelp = (on: boolean) => { searchPop.hidden = !on; searchHelp.setAttribute('aria-expanded', String(on)); };
		this.on(win, 'click', (e) => {
			// a click anywhere else closes the search help
			if (!searchPop.hidden && !(e.target as Element).closest('.search-pop, .search-help')) showSearchHelp(false);
			const target = (e.target as Element).closest<HTMLElement>('[data-view], [data-action], [data-set], [data-accent], [data-only], [data-skill]');
			if (!target) return;
			// a skill in the Skills box: hide its maps, or show them again
			if (target.dataset.skill) {
				// four steps: shown → focused (only maps it's a top skill of) → its main-skill maps hidden → every map
				// it's a top skill of hidden → shown
				const sk = target.dataset.skill, { hidden, removed, focused } = this.settings;
				const without = (list: string[]) => list.filter((x) => x !== sk);
				if (removed.includes(sk)) this.save({ removed: without(removed), hidden: without(hidden), focused: without(focused) });
				else if (hidden.includes(sk)) this.save({ hidden: without(hidden), removed: [...removed, sk] });
				else if (focused.includes(sk)) this.save({ focused: without(focused), hidden: [...hidden, sk] });
				else this.save({ focused: [...focused, sk] });
				applyLook();
				renderLists();
				return;
			}
			// a map's button: Recent plays, just that map's plays in the recent time (an empty value shows all again)
			if (target.dataset.only !== undefined) {
				only = Number(target.dataset.only) || 0;
				playsShown = PLAYS_BATCH;
				showPage('plays');
				renderLists();
				playsList.scrollTop = 0;
				return;
			}
			const { view, set, value, accent, action } = target.dataset;
			if (view) { showPage(view as View); return; }
			if (set) {
				this.save({ [set]: value } as Partial<Settings>);
				applyLook();
				if (set === 'recent') $('.recent-best').hidden = page !== 'best' || value === 'hide' || allTime;
				if (set === 'genz' && value === 'on') genz.viewShown(listsOf(page));
				if (set === 'share' && value === 'on') startSharing();
				if (['unit', 'skillsAs', 'strainAs', 'recentUnit', 'oldOn', 'oldUnit', 'outdateLevel', 'outdatePrestige'].includes(set)) renderLists();
				// Strain: picked again from the other plays, if it was picked
				if ((set === 'strainMode' || set === 'strainUnit') && suggested) void pickSuggest();
				return;
			}
			if (accent) {
				this.save({ accent: accent as AccentId });
				applyLook();
				if (accent === 'custom') customColor.click();
				return;
			}
			switch (action) {
				case 'refresh': void refreshNow(target); if (page === 'shared') void loadShared(true); break;
				case 'save-playlist': void savePlaylistNow(target); break;
				case 'save-all-time': void saveAllTime(target); break;
				case 'pick-open': picked = picked ?? []; drawPicked(); break;
				case 'pick-close': picked = null; closePickMenu(); drawPicked(); break;
				case 'pick-add': {
					const map = Number(target.dataset.map), rate = Number(target.dataset.rate);
					if (picked && !picked.some((m) => m.map === map && m.rate === rate)) picked.push({ map, rate, repeat: 1 });
					closePickMenu();
					drawPicked();
					break;
				}
				case 'pick-remove': picked?.splice(Number(target.dataset.i), 1); drawPicked(); break;
				case 'pick-create': void createPicked(target); break;
				case 'share-yes': case 'share-no':
					this.save({ share: action === 'share-yes' ? 'on' : 'off' });
					if (action === 'share-yes') startSharing();
				showPool();
					$('.share-veil').hidden = true;
					applyLook();
					break;
				case 'share-show': {
					const sample = $<HTMLTextAreaElement>('.share-ask .sample');
					sample.hidden = !sample.hidden;
					if (!sample.hidden) sample.value = shareSample();
					target.textContent = sample.hidden ? TEXT.shareShow : TEXT.shareHide;
					break;
				}
				case 'reset-skills': this.save({ hidden: [], removed: [], focused: [] }); applyLook(); renderLists(); break;
				case 'suggest': void pickSuggest(); break;
				case 'close': setOpen(false); break;
				case 'settings': showPage(page === 'settings' ? this.settings.view : 'settings'); break;
				case 'search-help': showSearchHelp(searchPop.hidden); break;
				case 'debug': showPage(page === 'debug' ? this.settings.view : 'debug'); break;
				case 'changelog': showPage(page === 'changelog' ? this.settings.view : 'changelog'); break;
				case 'copy': e.preventDefault(); copyDebug(target); break;
				case 'all-time':
					// the title says which list it is; the button, the one it switches to
					allTime = !allTime;
					$('[data-best-title]').textContent = allTime ? TEXT.allTime : TEXT.best;
					target.textContent = allTime ? TEXT.best : TEXT.allTime;
					$('[data-all-time-save]').hidden = !allTime;
					$('.recent-best').hidden = allTime || page !== 'best' || this.settings.recent === 'hide';
					renderLists();
					genz.viewShown(listsOf(page));
					break;
				case 'advanced':
					this.save({ advanced: this.settings.advanced === 'on' ? 'off' : 'on' });
					applyLook();
					// the time tags work only in Advanced mode
					query = parseSearch(searchBox.value, Date.now(), this.settings.advanced === 'on');
					renderLists();
					break;
				case 'record':
					this.recording = true;
					keyButton.classList.add('recording');
					keyButton.textContent = TEXT.pressKeys;
					break;
				case 'reset-key': this.save({ hotkey: DEFAULTS.hotkey }); stopRecording(); bindToggle(); break;
			}
		});
		// advanced mode: Shift + click on a play (a map: its latest play) copies it as the debug view shows it
		const advancedClick = (e: Event) => e instanceof MouseEvent && e.shiftKey && this.settings.advanced === 'on';
		// the row says Copied, or why it couldn't
		const copyPlay = async (row: HTMLElement) => {
			const [at, beatmapId] = row.dataset.play!.split(':').map(Number);
			let note: string = TEXT.copied;
			try {
				const play = await debugPlay(at!, beatmapId!);
				if (!play) note = TEXT.playNotFound;
				else await navigator.clipboard.writeText(JSON.stringify(play, null, 2));
			} catch { note = TEXT.copyFailed; }
			row.dataset.copied = note;
			if (note === TEXT.copied) genz.copied();
			row.classList.add('copied');
			window.setTimeout(() => row.classList.remove('copied'), 2000);
		};
		const toggleRow = (e: Event) => {
			const row = (e.target as Element).closest<HTMLElement>('.row[role="button"]');
			if (!row) return;
			if (advancedClick(e)) {
				if (row.dataset.play) void copyPlay(row);
				return;
			}
			if (e instanceof KeyboardEvent) {
				if (e.key !== 'Enter' && e.key !== ' ') return;
				e.preventDefault();
			}
			const detail = row.nextElementSibling as HTMLElement | null;
			if (!detail?.classList.contains('detail')) return;
			detail.hidden = !detail.hidden;
			row.setAttribute('aria-expanded', String(!detail.hidden));
			if (!detail.hidden) genz.rowOpened(detail);
		};
		for (const list of [playsList, bestList, recentList, skillsList, sharedList, $('[data-suggest]')]) {
			this.on(list, 'click', toggleRow);
			// Shift + click would select text
			this.on(list, 'mousedown', (e) => { if (advancedClick(e)) e.preventDefault(); });
			this.on(list, 'keydown', toggleRow);
		}
	}
}
