// The add-on: its window in a shadow root, the shortcut (set in Settings), and loading the lists. Everything
// registered here is undone by the SDK when the add-on stops (disabled, updated or removed). Nothing runs while the
// window is closed, and while it's open, only clicks and keys do anything.

import { Addon, HotkeyManager, isolateInput, keepFocus } from '@oss-idle/addon-sdk';
import { TrackerError, recent7k } from './data.js';
import { bestMaps } from './logic.js';
import { DEFAULTS, type Settings, type View, hotkeyLabel, hotkeyOf, loadSettings, settingsStore } from './settings.js';
import styles from './styles.css';
import { TEXT } from './text.js';
import { bestHtml, messageHtml, playsHtml } from './view.js';

type Api = Parameters<typeof recent7k>[0];
type Page = View | 'settings';

// Tabler Icons (MIT): settings, outline
const GEAR = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/></svg>';

export class Tracker extends Addon {
	private readonly hotkeys = new HotkeyManager();
	private settings: Settings = loadSettings();
	private toggleKey?: () => void;
	private escape?: () => void;
	private recording = false;
	private loading = 0;

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
		root.innerHTML = `<style>${styles}</style>
			<div class="window" role="dialog" aria-label="${TEXT.name}" hidden>
				<div class="head">
					<span class="title">${TEXT.name}</span>
					<span class="seg" role="tablist" aria-label="${TEXT.views}">
						<button type="button" role="tab" data-view="plays" aria-selected="true">${TEXT.plays}</button>
						<button type="button" role="tab" data-view="best" aria-selected="false">${TEXT.best}</button>
					</span>
					<span class="spacer"></span>
					<button type="button" class="btn" data-action="refresh">${TEXT.refresh}</button>
					<button type="button" class="icon-btn" data-action="settings" aria-label="${TEXT.settings}" title="${TEXT.settings}" aria-pressed="false">${GEAR}</button>
					<button type="button" class="close" data-action="close" aria-label="${TEXT.close}" title="${TEXT.close}">✕</button>
				</div>
				<div class="panels">
					<section class="card plays"><div class="card-head"><span class="title">${TEXT.plays}</span><span class="muted" data-count></span></div><div class="list" data-list="plays"></div></section>
					<section class="card best" hidden><div class="card-head"><span class="title">${TEXT.best}</span><span class="muted">${TEXT.bestNote}</span></div><div class="list" data-list="best"></div></section>
					<section class="card settings" hidden><div class="card-head"><span class="title">${TEXT.settings}</span></div>
						<div class="settings-row">
							<div class="label"><div>${TEXT.keybind}</div><div class="muted" data-key-help>${TEXT.keybindHelp}</div></div>
							<button type="button" class="keybind" data-action="record"></button>
							<button type="button" class="btn" data-action="reset-key">${TEXT.reset}</button>
						</div>
					</section>
				</div>
			</div>`;
		document.body.appendChild(host);
		this.own(() => host.remove());
		// keys typed and the wheel turned in the window stay in it, and the game doesn't take focus from it
		this.own(isolateInput(host));
		this.own(keepFocus(host));
		this.own(() => this.hotkeys.dispose());

		const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
		const win = $('.window'), playsList = $('[data-list="plays"]'), bestList = $('[data-list="best"]'), count = $('[data-count]');
		const keyButton = $('[data-action="record"]'), keyHelp = $('[data-key-help]'), gear = $('[data-action="settings"]');

		const stopRecording = () => {
			this.recording = false;
			keyButton.classList.remove('recording');
			keyButton.textContent = hotkeyLabel(this.settings.hotkey);
			keyHelp.textContent = TEXT.keybindHelp;
		};

		let page: Page = this.settings.view;
		const showPage = (next: Page) => {
			page = next;
			for (const b of root.querySelectorAll<HTMLElement>('.seg button')) b.setAttribute('aria-selected', String(b.dataset.view === next));
			$('.plays').hidden = next !== 'plays';
			$('.best').hidden = next !== 'best';
			$('.settings').hidden = next !== 'settings';
			gear.setAttribute('aria-pressed', String(next === 'settings'));
			if (next !== 'settings' && next !== this.settings.view) this.save({ view: next });
			stopRecording();
		};

		const load = async () => {
			const ticket = ++this.loading;
			playsList.innerHTML = bestList.innerHTML = messageHtml(TEXT.loading);
			try {
				const api = (this.host as { api?: Api } | undefined)?.api ?? (globalThis as { ossIdle?: { api?: Api } }).ossIdle?.api;
				const plays = await recent7k(api);
				if (ticket !== this.loading) return;
				count.textContent = plays.length ? `· ${plays.length}` : '';
				playsList.innerHTML = playsHtml(plays, Date.now());
				bestList.innerHTML = bestHtml(bestMaps(plays));
			} catch (e) {
				if (ticket !== this.loading) return;
				this.log.error('loading failed', e);
				playsList.innerHTML = messageHtml(e instanceof TrackerError ? e.message : String(e), true);
				bestList.innerHTML = '';
			}
		};

		const setOpen = (open: boolean) => {
			win.hidden = !open;
			// Esc is taken only while the window is open: closed, it's the game's. While recording, it cancels.
			this.escape?.();
			this.escape = open ? this.hotkeys.register('Escape', () => { if (this.recording) stopRecording(); else setOpen(false); }, { allowInText: true }) : undefined;
			if (open) void load(); else stopRecording();
		};

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

		showPage(page);

		// one listener for the header and settings buttons, one per list for opening a row's breakdown
		this.on(win, 'click', (e) => {
			const target = (e.target as Element).closest<HTMLElement>('[data-view], [data-action]');
			if (!target) return;
			if (target.dataset.view) { showPage(target.dataset.view as View); return; }
			switch (target.dataset.action) {
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
