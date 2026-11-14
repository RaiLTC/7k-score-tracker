// The add-on: its window in a shadow root, the shortcut, and loading the lists. Everything registered here is undone
// by the SDK when the add-on stops (disabled, updated or removed). Nothing runs while the window is closed, and
// while it's open, only clicks and keys do anything.

import { Addon, HotkeyManager, isolateInput, keepFocus } from '@oss-idle/addon-sdk';
import { TrackerError, recent7k } from './data.js';
import { bestMaps } from './logic.js';
import styles from './styles.css';
import { TEXT } from './text.js';
import { bestHtml, messageHtml, playsHtml } from './view.js';

const TOGGLE = 'Alt+Shift+R';
/** Which view is shown: remembered on this computer (a convenience only, so a failed save changes nothing). */
const VIEW_KEY = 'oss-idle-addon:7k-score-tracker:view';
type View = 'plays' | 'best';

export class Tracker extends Addon {
	private readonly hotkeys = new HotkeyManager();
	private escape?: () => void;
	private loading = 0;

	constructor() {
		super({ name: TEXT.name });
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
					<button type="button" class="close" data-action="close" aria-label="${TEXT.close}" title="${TEXT.close}">✕</button>
				</div>
				<div class="panels">
					<section class="card plays"><div class="card-head"><span class="title">${TEXT.plays}</span><span class="muted" data-count></span></div><div class="list" data-list="plays"></div></section>
					<section class="card best" hidden><div class="card-head"><span class="title">${TEXT.best}</span><span class="muted">${TEXT.bestNote}</span></div><div class="list" data-list="best"></div></section>
				</div>
			</div>`;
		document.body.appendChild(host);
		this.own(() => host.remove());
		// keys typed and the wheel turned in the window stay in it, and the game doesn't take focus from it
		this.own(isolateInput(host));
		this.own(keepFocus(host));
		this.own(() => this.hotkeys.dispose());

		const win = root.querySelector<HTMLElement>('.window')!;
		const playsList = root.querySelector<HTMLElement>('[data-list="plays"]')!;
		const bestList = root.querySelector<HTMLElement>('[data-list="best"]')!;
		const count = root.querySelector<HTMLElement>('[data-count]')!;

		const showView = (view: View) => {
			for (const b of root.querySelectorAll<HTMLElement>('.seg button')) b.setAttribute('aria-selected', String(b.dataset.view === view));
			root.querySelector<HTMLElement>('.plays')!.hidden = view !== 'plays';
			root.querySelector<HTMLElement>('.best')!.hidden = view !== 'best';
			try { localStorage.setItem(VIEW_KEY, view); } catch { /* not remembered */ }
		};
		let saved: View = 'plays';
		try { saved = localStorage.getItem(VIEW_KEY) === 'best' ? 'best' : 'plays'; } catch { /* the default */ }
		showView(saved);

		const load = async () => {
			const ticket = ++this.loading;
			playsList.innerHTML = bestList.innerHTML = messageHtml(TEXT.loading);
			try {
				const plays = await recent7k((this.host as { api?: Parameters<typeof recent7k>[0] } | undefined)?.api
					?? (globalThis as { ossIdle?: { api?: Parameters<typeof recent7k>[0] } }).ossIdle?.api);
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
			// Esc is taken only while the window is open: closed, it's the game's
			this.escape?.();
			this.escape = open ? this.hotkeys.register('Escape', () => setOpen(false), { allowInText: true }) : undefined;
			if (open) void load();
		};
		this.own(this.hotkeys.register(TOGGLE, () => setOpen(win.hidden), { allowInText: true }));
		this.own(() => this.escape?.());

		// one listener for the header's buttons, one per list for opening a row's breakdown (click, Enter or Space)
		this.on(root.querySelector('.head')!, 'click', (e) => {
			const target = (e.target as Element).closest<HTMLElement>('[data-view], [data-action]');
			if (!target) return;
			if (target.dataset.view) showView(target.dataset.view as View);
			else if (target.dataset.action === 'refresh') void load();
			else if (target.dataset.action === 'close') setOpen(false);
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
