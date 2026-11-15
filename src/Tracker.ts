// The add-on: its window in a shadow root, the shortcut (set in Settings), and loading the lists. Everything
// registered here is undone by the SDK when the add-on stops (disabled, updated or removed). Nothing runs while the
// window is closed, and while it's open, only clicks and keys do anything.

import { Addon, HotkeyManager, isolateInput, keepFocus } from '@oss-idle/addon-sdk';
import { TrackerError, latestMark, recent7k } from './data.js';
import { type Play, bestMaps } from './logic.js';
import { ACCENTS, type AccentId, DEFAULTS, type Settings, type View, accentOf, hotkeyLabel, hotkeyOf, loadSettings, NUMBER_SETTINGS, recentMs, settingsStore, wholeOf } from './settings.js';
import styles from './styles.css';
import { TEXT } from './text.js';
import { bestHtml, bySkillHtml, legendHtml, messageHtml, playsHtml } from './view.js';

type Api = Parameters<typeof recent7k>[0];
type Page = View | 'settings';

/** How often, while the window is open, it checks for a new play. */
const POLL_MS = 2000;

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

const settingRow = (label: string, help: string, control: string, attrs = '') =>
	`<div class="settings-row"><div class="label"><div>${label}</div><div class="muted"${attrs}>${help}</div></div>${control}</div>`;

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
		host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50000;';
		const root = host.attachShadow({ mode: 'open' });
		const swatches = ([...Object.entries(ACCENTS), ['custom', '']] as [string, string][]).map(([id, color]) =>
			`<button type="button" role="radio" data-accent="${id}" aria-checked="false" aria-label="${TEXT.accents[id]}" title="${TEXT.accents[id]}"${color ? ` style="background:${color}"` : ' class="custom"'}></button>`).join('');
		root.innerHTML = `<style>${styles}</style>
			<div class="window" role="dialog" aria-label="${TEXT.name}" hidden>
				<div class="head">
					<span class="title">${TEXT.name}</span>
					<span class="seg" role="tablist" aria-label="${TEXT.views}">
						<button type="button" role="tab" data-view="plays" aria-selected="true">${TEXT.plays}</button>
						<button type="button" role="tab" data-view="best" aria-selected="false">${TEXT.best}</button>
						<button type="button" role="tab" data-view="skills" aria-selected="false">${TEXT.bySkill}</button>
					</span>
					<span class="spacer"></span>
					<span data-unit-switch>${choice('unit', TEXT.unit, TEXT.units)}</span>
					<button type="button" class="btn" data-action="refresh">${TEXT.refresh}</button>
					<button type="button" class="icon-btn" data-action="settings" aria-label="${TEXT.settings}" title="${TEXT.settings}" aria-pressed="false">${GEAR}</button>
					<button type="button" class="close" data-action="close" aria-label="${TEXT.close}" title="${TEXT.close}">✕</button>
				</div>
				<div class="panels">
					<section class="card plays"><div class="card-head"><span class="title">${TEXT.plays}</span><span class="muted" data-count></span></div><div class="list" data-list="plays"></div></section>
					<section class="card legend" hidden><div class="card-head"><span class="title">${TEXT.skillsTitle}</span></div><div class="legend-list">${legendHtml()}</div></section>
					<section class="card best recent-best" hidden><div class="card-head"><span class="title" data-recent-title></span><span class="muted" data-recent-note></span></div><div class="list" data-list="recent"></div></section>
					<section class="card best" hidden><div class="card-head"><span class="title">${TEXT.best}</span><span class="muted" data-best-note></span></div><div class="list" data-list="best"></div></section>
					<section class="card by-skill" hidden><div class="card-head"><span class="title">${TEXT.bySkill}</span><span class="muted">${TEXT.bySkillNote}</span></div><div class="list" data-list="skills"></div></section>
					<section class="card settings" hidden><div class="card-head"><span class="title">${TEXT.settings}</span></div>
						${settingRow(TEXT.keybind, TEXT.keybindHelp, `<button type="button" class="keybind" data-action="record"></button><button type="button" class="btn" data-action="reset-key">${TEXT.reset}</button>`, ' data-key-help')}
						${settingRow(TEXT.skillsAs, TEXT.skillsAsHelp, choice('skillsAs', TEXT.skillsAs, TEXT.skillsAsOptions))}
						${settingRow(TEXT.recent, TEXT.recentHelp, choice('recent', TEXT.recent, TEXT.recentOptions))}
						${settingRow(TEXT.recentFor, TEXT.recentForHelp, `<span class="recent-for"><input type="number" class="num-field" min="1" max="999" step="1" inputmode="numeric" aria-label="${TEXT.recentFor}" data-number="recentFor">${choice('recentUnit', TEXT.recentFor, TEXT.recentUnits)}</span>`)}
						${settingRow(TEXT.recentCount, TEXT.recentCountHelp, `<input type="number" class="num-field" min="1" max="999" step="1" inputmode="numeric" aria-label="${TEXT.recentCount}" data-number="recentCount">`)}
						${settingRow(TEXT.bestCount, TEXT.bestCountHelp, `<input type="number" class="num-field" min="1" max="999" step="1" inputmode="numeric" aria-label="${TEXT.bestCount}" data-number="bestCount">`)}
						${settingRow(TEXT.buttonStyle, TEXT.buttonStyleHelp, choice('buttons', TEXT.buttonStyle, TEXT.buttonStyles))}
						${settingRow(TEXT.accent, TEXT.accentHelp, `<span class="swatches" role="radiogroup" aria-label="${TEXT.accent}">${swatches}<input type="color" tabindex="-1" aria-hidden="true" data-custom-color></span>`)}
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
		const win = $('.window'), playsList = $('[data-list="plays"]'), bestList = $('[data-list="best"]'), recentList = $('[data-list="recent"]'), skillsList = $('[data-list="skills"]'), count = $('[data-count]');
		const keyButton = $('[data-action="record"]'), keyHelp = $('[data-key-help]'), gear = $('[data-action="settings"]');
		const customColor = $<HTMLInputElement>('[data-custom-color]');
		const numbers = [...root.querySelectorAll<HTMLInputElement>('[data-number]')];

		// the settings that change how the window looks, applied all at once
		const applyLook = () => {
			const s = this.settings, accent = accentOf(s);
			win.dataset.buttons = s.buttons;
			win.style.setProperty('--accent', accent);
			win.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 12%, transparent)`);
			win.style.setProperty('--on-accent', onAccent(accent));
			for (const b of root.querySelectorAll<HTMLElement>('[data-set]')) b.setAttribute('aria-checked', String(String(s[b.dataset.set as keyof Settings]) === b.dataset.value));
			for (const b of root.querySelectorAll<HTMLElement>('[data-accent]')) b.setAttribute('aria-checked', String(b.dataset.accent === s.accent));
			$('.swatches .custom').style.background = s.accent === 'custom' ? s.customAccent : '';
			customColor.value = s.customAccent;
			for (const input of numbers) input.value = String(s[input.dataset.number as typeof NUMBER_SETTINGS[number]]);
			$('[data-best-note]').textContent = $('[data-recent-note]').textContent = TEXT.bestNote[s.unit] ?? '';
			$('[data-recent-title]').textContent = TEXT.recentTitle(s.recentFor, s.recentUnit);
		};

		let plays: Play[] | null = null;
		const renderLists = () => {
			if (!plays) return;
			// what's open stays open when the lists are drawn again
			const open = new Set([...root.querySelectorAll<HTMLElement>('[aria-expanded="true"], details[open]')].map((el) => el.dataset.key));
			playsList.innerHTML = playsHtml(plays, Date.now(), this.settings.unit, this.settings.skillsAs);
			const s = this.settings, now = Date.now(), since = now - recentMs(s), title = TEXT.recentTitle(s.recentFor, s.recentUnit);
			const maps = bestMaps(plays);
			bestList.innerHTML = bestHtml(maps.slice(0, s.bestCount), s.unit, s.skillsAs, since, TEXT.stale(title));
			// the recent list counts only the plays inside the time
			recentList.innerHTML = bestHtml(bestMaps(plays.filter((p) => p.playedAt >= since)).slice(0, s.recentCount), s.unit, s.skillsAs, 0, '', TEXT.noRecent(title));
			this.drawnAt = now;
			skillsList.innerHTML = bySkillHtml(maps, this.settings.unit);
			if (!open.size) return;
			for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
				if (!open.has(el.dataset.key)) continue;
				if (el instanceof HTMLDetailsElement) { el.open = true; continue; }
				el.setAttribute('aria-expanded', 'true');
				(el.nextElementSibling as HTMLElement).hidden = false;
			}
		};

		const stopRecording = () => {
			this.recording = false;
			keyButton.classList.remove('recording');
			keyButton.textContent = hotkeyLabel(this.settings.hotkey);
			keyHelp.textContent = TEXT.keybindHelp;
		};

		let page: Page = this.settings.view;
		const showPage = (next: Page) => {
			page = next;
			for (const b of root.querySelectorAll<HTMLElement>('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === next));
			$('.plays').hidden = next !== 'plays';
			$('.best:not(.recent-best)').hidden = $('.legend').hidden = next !== 'best';
			$('.recent-best').hidden = next !== 'best' || this.settings.recent === 'hide';
			$('.by-skill').hidden = next !== 'skills';
			$('.settings').hidden = next !== 'settings';
			$('[data-unit-switch]').hidden = next === 'settings';
			gear.setAttribute('aria-pressed', String(next === 'settings'));
			if (next !== 'settings' && next !== this.settings.view) this.save({ view: next });
			stopRecording();
		};

		const load = async () => {
			const ticket = ++this.loading;
			// the first time only: after that, the old lists stay up until the new ones are ready
			if (!plays) playsList.innerHTML = bestList.innerHTML = recentList.innerHTML = skillsList.innerHTML = messageHtml(TEXT.loading);
			try {
				const api = (this.host as { api?: Api } | undefined)?.api ?? (globalThis as { ossIdle?: { api?: Api } }).ossIdle?.api;
				// the mark first: anything saved while reading shows up on the next check
				this.mark = await latestMark().catch(() => this.mark);
				const result = await recent7k(api);
				if (ticket !== this.loading) return;
				plays = result;
				count.textContent = plays.length ? `· ${plays.length}` : '';
				renderLists();
			} catch (e) {
				if (ticket !== this.loading) return;
				this.log.error('loading failed', e);
				const message = messageHtml(e instanceof TrackerError ? e.message : TEXT.loadFailed, true);
				playsList.innerHTML = bestList.innerHTML = recentList.innerHTML = skillsList.innerHTML = message;
			}
		};

		const setOpen = (open: boolean) => {
			win.hidden = !open;
			guard(open);
			// Esc is taken only while the window is open: closed, it's the game's. While recording, it cancels.
			this.escape?.();
			this.escape = open ? this.hotkeys.register('Escape', () => { if (this.recording) stopRecording(); else setOpen(false); }, { allowInText: true }) : undefined;
			// while open, a tiny check every 2 seconds: the lists are read again only when a play or its XP was saved
			window.clearInterval(this.poll);
			if (open) {
				void load();
				this.poll = window.setInterval(() => void latestMark().then((m) => {
					if (m && m !== this.mark) void load();
					// no new play: once a minute, draw again so times, the recent list and gray maps keep up
					else if (Date.now() - this.drawnAt >= 60e3) renderLists();
				}, () => undefined), POLL_MS);
			} else stopRecording();
		};
		this.own(() => window.clearInterval(this.poll));

		// the shortcut: registered from the setting, and again whenever it changes
		const bindToggle = () => {
			this.toggleKey?.();
			this.toggleKey = this.hotkeys.register(this.settings.hotkey, () => { if (!this.recording) setOpen(win.hidden); }, { allowInText: true });
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
		for (const input of numbers) {
			this.on(input, 'change', () => {
				const n = wholeOf(input.value);
				if (n !== null) { this.save({ [input.dataset.number!]: n }); renderLists(); }
				applyLook();
			});
		}
		this.on(customColor, 'change', () => this.save({ accent: 'custom', customAccent: customColor.value }));

		applyLook();
		showPage(page);

		// dragged by its header (not its buttons); kept on screen
		const head = $('.head');
		this.on(head, 'pointerdown', (e) => {
			const p = e as PointerEvent;
			if (p.button !== 0 || (p.target as Element).closest('button')) return;
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
		this.on(win, 'click', (e) => {
			const target = (e.target as Element).closest<HTMLElement>('[data-view], [data-action], [data-set], [data-accent]');
			if (!target) return;
			const { view, set, value, accent, action } = target.dataset;
			if (view) { showPage(view as View); return; }
			if (set) {
				this.save({ [set]: value } as Partial<Settings>);
				applyLook();
				if (set === 'recent') $('.recent-best').hidden = page !== 'best' || value === 'hide';
				if (set === 'unit' || set === 'skillsAs' || set === 'recentUnit') renderLists();
				return;
			}
			if (accent) {
				this.save({ accent: accent as AccentId });
				applyLook();
				if (accent === 'custom') customColor.click();
				return;
			}
			switch (action) {
				case 'refresh': void load(); break;
				case 'close': setOpen(false); break;
				case 'settings': showPage(page === 'settings' ? this.settings.view : 'settings'); break;
				case 'record':
					this.recording = true;
					keyButton.classList.add('recording');
					keyButton.textContent = TEXT.pressKeys;
					break;
				case 'reset-key': this.save({ hotkey: DEFAULTS.hotkey }); stopRecording(); bindToggle(); break;
			}
		});
		const toggleRow = (e: Event) => {
			const row = (e.target as Element).closest<HTMLElement>('.row[role="button"]');
			if (!row) return;
			if (e instanceof KeyboardEvent) {
				if (e.key !== 'Enter' && e.key !== ' ') return;
				e.preventDefault();
			}
			const detail = row.nextElementSibling as HTMLElement | null;
			if (!detail?.classList.contains('detail')) return;
			detail.hidden = !detail.hidden;
			row.setAttribute('aria-expanded', String(!detail.hidden));
		};
		for (const list of [playsList, bestList]) {
			this.on(list, 'click', toggleRow);
			this.on(list, 'keydown', toggleRow);
		}
	}
}
