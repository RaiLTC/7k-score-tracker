// ADHD Mode: motion and sounds on top of the normal look (a setting, off by default).
// How much each thing moves follows its weight: what's used all the time (buttons, switches) moves least and fastest
// (about 0.1 s), a change of view a little more (about 0.2 s), and a new play, the moment the tracker is for, the
// most. Everything eases out, nothing waits for an animation before it works, and only transform and opacity move
// (CSS: the a-... classes in styles.css). Each animation and each sound can be turned off. Sounds are made by the
// browser (Web Audio): no files, short and quiet.

import { CLIP_LEAD, PARTY_HORNS } from './sound-clips.js';

export type SoundId = 'click' | 'tab' | 'open' | 'play' | 'best' | 'ticks' | 'flash' | 'copy' | 'surprise' | 'horn';
export type AnimId = 'buttons' | 'switches' | 'window' | 'pages' | 'flash' | 'bars' | 'plays' | 'rows' | 'confetti';
export type GenZOptions = { on: boolean, volume: number, mute: boolean, focusOnly: boolean, sounds: Record<SoundId, boolean>, anims: Record<AnimId, boolean> };
/** Whether a sound plays: ADHD Mode on, sounds not muted, that sound on, the volume above 0, and (when asked) the
 *  game in front: its window focused and its tab shown. */
const heard = (o: GenZOptions, sound: SoundId) => o.on && !o.mute && o.sounds[sound] && o.volume > 0 && (!o.focusOnly || (document.hasFocus() && !document.hidden));
const ANIMS: AnimId[] = ['buttons', 'switches', 'window', 'pages', 'flash', 'bars', 'plays', 'rows', 'confetti'];
/** The confetti's colours: the skills'. */
const CONFETTI = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#d946ef', '#ec4899', '#ffffff'];

const ROW_GAP = 80, BAR_GAP = 20, BAR_GROW = 300, VIEW_DELAY = 250, FLASH_DELAY = 60, FLASH_GAP = 45, FLASH_LEN = 350;
/** Each skill's note when its rows flash: a pentatonic scale, so any of them together sound right. */
const SKILL_NOTES: Record<string, number> = { accuracy: 523, speed: 587, stamina: 659, jacks: 784, independence: 880, ln: 1047, technical: 1175, focus: 1319, sv: 1568, memory: 1760 };
/** The Total XP column, by list: Recent plays has PP before it. */
const XP_COLUMN: Record<string, number> = { plays: 5, best: 4, recent: 4 };

const ease = (t: number) => 1 - (1 - t) ** 3;
const ANIMATING = new WeakMap<Element, Record<string, number>>();
/** Play a CSS animation class once: restarted if it's playing, and taken off when done (left on, the browser plays it
 *  again whenever the element is shown again, like a list on a page opened later). */
const replay = (el: Element, cls: string, ms = 1500) => {
	el.classList.remove(cls);
	void (el as HTMLElement).offsetWidth;
	el.classList.add(cls);
	const timers = ANIMATING.get(el) ?? {};
	ANIMATING.set(el, timers);
	window.clearTimeout(timers[cls]);
	timers[cls] = window.setTimeout(() => el.classList.remove(cls), ms);
};
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const createGenZ = (root: ShadowRoot, win: HTMLElement, options: () => GenZOptions) => {
	const on = () => options().on;
	/** Whether an animation plays: ADHD Mode on, and that animation on. */
	const anim = (id: AnimId) => { const o = options(); return o.on && o.anims[id]; };

	// ---- sounds ----
	let audio: AudioContext | undefined;
	/** One note: a frequency (Hz) that can glide to another, its wave, how loud (0-1) and how long (s), `at` s from
	 *  now. Before the first click the browser holds sound back, and notes queued then would all play at once later:
	 *  they're skipped. */
	const note = (sound: SoundId, f: number, { to = f, wave = 'sine' as OscillatorType, vol = 0.1, len = 0.2, at = 0 } = {}) => {
		const o = options();
		if (!heard(o, sound)) return undefined;
		try {
			audio ??= new AudioContext();
			if (audio.state === 'suspended') void audio.resume();
			if (audio.state !== 'running') return undefined;
			const t = audio.currentTime + at, osc = audio.createOscillator(), gain = audio.createGain();
			osc.type = wave;
			osc.frequency.setValueAtTime(f, t);
			osc.frequency.exponentialRampToValueAtTime(to, t + len);
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(vol * (o.volume / 100), t + 0.005);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
			osc.connect(gain).connect(audio.destination);
			osc.start(t);
			osc.stop(t + len + 0.02);
			return osc;
		} catch { return undefined; }
	};
	/** A burst of noise through a band (Hz), for mechanical sounds, `at` s from now. */
	const noise = (sound: SoundId, band: number, { vol = 0.1, len = 0.03, at = 0 } = {}) => {
		const o = options();
		if (!heard(o, sound) || audio?.state !== 'running') return;
		try {
			const t = audio.currentTime + at, frames = Math.ceil(audio.sampleRate * len);
			const buffer = audio.createBuffer(1, frames, audio.sampleRate), data = buffer.getChannelData(0);
			for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
			const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
			src.buffer = buffer;
			filter.type = 'bandpass';
			filter.frequency.value = band;
			filter.Q.value = 3;
			gain.gain.value = vol * (o.volume / 100);
			src.connect(filter).connect(gain).connect(audio.destination);
			src.start(t);
		} catch { /* no sound */ }
	};
	/** Recorded clips (sound-clips.ts), decoded the first time they're needed. */
	const decode = (clips: string[]) => Promise.all(clips.map((b64) => audio!.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer)));
	let horns: Promise<AudioBuffer[]> | undefined;
	const hornBuffers = () => (horns ??= decode(PARTY_HORNS));
	/** One of a set of recorded clips, picked at random, `at` s from now, at `vol` (0-1), fading out at its end. */
	const clip = (sound: SoundId, buffers: () => Promise<AudioBuffer[]>, at: number, vol: number) => {
		const o = options();
		if (!heard(o, sound) || audio?.state !== 'running') return;
		const a = audio, asked = a.currentTime;
		void buffers().then((list) => {
			const buf = list[Math.floor(Math.random() * list.length)];
			if (!buf) return;
			const t = Math.max(a.currentTime, asked + at), len = buf.duration - CLIP_LEAD, src = a.createBufferSource(), gain = a.createGain();
			src.buffer = buf;
			gain.gain.setValueAtTime(vol * (o.volume / 100), t);
			gain.gain.setValueAtTime(vol * (o.volume / 100), t + len - 0.06);
			gain.gain.linearRampToValueAtTime(0, t + len);
			src.connect(gain).connect(a.destination);
			src.start(t, CLIP_LEAD);
			src.stop(t + len);
		}, () => undefined);
	};
	// a bar's tick: higher for a taller bar, in one of four sounds, a little off each time so a run of them doesn't
	// sound like a machine
	const TICKS: ((f: number) => [number, number, OscillatorType, number])[] = [
		(f) => [f, f * 0.6, 'triangle', 0.025],
		(f) => [f * 1.5, f * 1.2, 'sine', 0.03],
		(f) => [f * 0.75, f * 0.5, 'square', 0.015],
		(f) => [f * 2, f * 2.4, 'sine', 0.02],
	];
	const sounds = {
		click: () => note('click', 1800, { to: 900, wave: 'triangle', vol: 0.08, len: 0.035 }),
		tab: () => note('tab', 1100, { to: 1400, wave: 'triangle', vol: 0.07, len: 0.06 }),
		open: () => note('open', 520, { to: 780, vol: 0.06, len: 0.12 }),
		// a new play: two notes, and a third higher one when it gave more XP than the play before (lower when less)
		play: (trend: string) => {
			note('play', 659, { vol: 0.09, len: 0.25 });
			note('play', 988, { vol: 0.08, len: 0.3, at: 0.07 });
			if (trend === 'up') note('play', 1319, { vol: 0.08, len: 0.45, at: 0.14 });
			if (trend === 'down') note('play', 784, { vol: 0.06, len: 0.3, at: 0.14 });
		},
		// a new first place: an old cash register, quietly: the keys and gears clatter, the drawer thunks, the bell
		// rings (a bell's tones aren't in tune with each other: 1, 2.76 and 5.4 times its note)
		best: () => {
			note('best', 1, { len: 0.01 }); // wakes the sound up if the browser had it held back
			[0, 0.035, 0.065, 0.1].forEach((at, i) => noise('best', 2500 + i * 400, { vol: 0.35, len: 0.025, at: 0.25 + at }));
			note('best', 140, { to: 90, vol: 0.12, len: 0.08, at: 0.38 });
			noise('best', 900, { vol: 0.25, len: 0.05, at: 0.38 });
			[[1, 0.06, 1.1], [2.76, 0.025, 0.7], [5.4, 0.012, 0.4]].forEach(([k, vol, len]) => note('best', 2090 * k!, { vol, len, at: 0.45 }));
		},
		tick: (height: number, at: number) => {
			const [f, to, wave, len] = TICKS[Math.floor(Math.random() * TICKS.length)]!((900 + height * 900) * (0.96 + Math.random() * 0.08));
			note('ticks', f, { to, wave, len, vol: wave === 'square' ? 0.015 : 0.035, at });
		},
		copy: () => note('copy', 1400, { to: 2000, vol: 0.06, len: 0.08 }),
		// a row flashing: its dominant skill's note, short and soft
		flash: (skill: string, at: number) => note('flash', SKILL_NOTES[skill] ?? 1000, { wave: 'triangle', vol: 0.05, len: 0.14, at }),
		// a map that gives accuracy XP: a party popper, its confetti, then a party horn (a recording: one of three blows)
		surprise: () => {
			note('surprise', 1, { len: 0.01 }); // wakes the sound up if the browser had it held back
			noise('surprise', 1400, { vol: 0.9, len: 0.07 });
			note('surprise', 160, { to: 60, vol: 0.15, len: 0.09 });
			// the confetti: a shower of tiny paper ticks, thick at first, then thinning out as it lands
			for (let i = 0; i < 28; i++) {
				const at = 0.05 + (Math.random() ** 1.6) * 1.1;
				noise('surprise', 4500 + Math.random() * 3500, { vol: 0.12 * (1 - at / 1.3), len: 0.008 + Math.random() * 0.012, at });
			}
			clip('horn', hornBuffers, 0.15, 0.45);
		},
	};
	const onPress = (e: Event) => {
		const b = (e.target as Element).closest('button, .row[role="button"], summary');
		if (!b) return;
		if (b.closest('.seg')) sounds.tab(); else sounds.click();
	};
	root.addEventListener('pointerdown', onPress);
	// a Skills folder opened: its rows rise in
	const onToggle = (e: Event) => {
		const d = e.target as HTMLDetailsElement;
		if (anim('rows') && d.matches('.skill-group') && d.open) replay(d, 'enter', 600);
	};
	root.addEventListener('toggle', onToggle, true);

	// ---- switches: the picked look slides to the picked option ----
	for (const seg of root.querySelectorAll('.seg')) seg.insertAdjacentHTML('afterbegin', '<i class="pill" aria-hidden="true"></i>');
	/** Every switch on screen: read all positions, then write them. */
	const pills = () => {
		if (!anim('switches')) return;
		const places = [...root.querySelectorAll<HTMLElement>('.seg')].map((seg) => {
			const b = seg.querySelector<HTMLElement>('button[aria-selected="true"], button[aria-checked="true"]');
			return { pill: seg.firstElementChild as HTMLElement, w: b?.offsetWidth ?? 0, x: (b?.offsetLeft ?? 0) - 2 };
		});
		for (const { pill, w, x } of places) if (w) { pill.style.width = `${w}px`; pill.style.transform = `translateX(${x}px)`; }
	};

	// ---- maps coming into view: they flash, then their bars grow ----
	// A map on Recent plays, Effective Maps or the Strain tab flashes for a moment in its dominant skill's colour, with
	// that skill's note, the first time it comes into view (at least half of it), top to bottom, also while scrolling.
	// Then its Skills bars grow, row by row, once the flashes before them are done. Both happen once: not again after a
	// page switch or a list drawn again, only after the tracker was away (closed or the game hidden) for 5 minutes, or
	// for a new Strain pick. New plays don't flash (they have their own effect), but their bars grow. Only rows waiting
	// to grow hide their bars (.wait): lists this doesn't watch show theirs as always.
	const FLASH_LISTS = /^(plays|best|recent|suggest-)/;
	/** By list: the rows that have flashed, and the rows whose bars have grown (or are about to). */
	const flashed = new Map<string, Set<string>>(), grown = new Map<string, Set<string>>();
	const setOf = (sets: Map<string, Set<string>>, list: string) => {
		const set = sets.get(list) ?? new Set<string>();
		sets.set(list, set);
		return set;
	};
	const listOf = (row: HTMLElement) => row.closest<HTMLElement>('[data-list]')?.dataset.list ?? '';
	/** Turns not come yet, by row: undone (the row waits again) when the page changes before they come. */
	const pending = new Map<HTMLElement, { timers: number[], undo: (() => void)[] }>();
	const later = (row: HTMLElement, ms: number, run: () => void, undo: () => void) => {
		const p = pending.get(row) ?? { timers: [], undo: [] };
		pending.set(row, p);
		const timer = window.setTimeout(() => {
			p.timers.splice(p.timers.indexOf(timer), 1);
			p.undo.splice(p.undo.indexOf(undo), 1);
			if (!p.timers.length) pending.delete(row);
			run();
		}, Math.max(0, ms));
		p.timers.push(timer);
		p.undo.push(undo);
	};
	let flashSlot = 0, barSlot = 0;
	/** A row's dominant skill (its tallest bar, or its first top skill) and that skill's colour; read before writing. */
	const dominant = (r: HTMLElement) => {
		const top = [...r.querySelectorAll<HTMLElement>('.skills i[class]')].sort((a, b) => parseFloat(b.style.height) - parseFloat(a.style.height))[0];
		const el = top ?? r.querySelector<HTMLElement>('.top-skills [class*="tx-"]');
		if (!el) return null;
		return { skill: /(?:sk|tx)-(\w+)/.exec(el.className)?.[1] ?? '', colour: top ? getComputedStyle(el).backgroundColor : getComputedStyle(el).color };
	};
	/** Rows just come into view, top to bottom. */
	const show = (rows: HTMLElement[]) => {
		const now = performance.now();
		// reads first (colours), then writes
		const plan = rows.map((r) => {
			const list = listOf(r), key = r.dataset.key ?? '';
			const flash = anim('flash') && FLASH_LISTS.test(list) && !setOf(flashed, list).has(key) ? dominant(r) : null;
			return { r, list, key, flash, grow: anim('bars') && r.classList.contains('wait') && !setOf(grown, list).has(key) };
		});
		let flashesEnd = now;
		for (const { r, list, key, flash } of plan) {
			if (!flash) continue;
			setOf(flashed, list).add(key);
			const at = Math.max(now + FLASH_DELAY, flashSlot);
			flashSlot = at + FLASH_GAP;
			flashesEnd = at + FLASH_LEN;
			r.style.setProperty('--c', flash.colour);
			if (!r.querySelector(':scope > .flash')) r.insertAdjacentHTML('beforeend', '<i class="flash"></i>');
			later(r, at - now, () => { replay(r, 'blink', 600); sounds.flash(flash.skill, 0); }, () => setOf(flashed, list).delete(key));
		}
		for (const { r, list, key, grow } of plan) {
			if (!grow) continue;
			setOf(grown, list).add(key);
			const at = Math.max(now, flashesEnd, barSlot);
			barSlot = at + ROW_GAP;
			later(r, at - now, () => {
				r.classList.replace('wait', 'growing');
				// a tick as every other bar lands, so a page doesn't rattle (the bars' heights come from their style, not
				// from layout)
				let n = 0;
				[...r.querySelectorAll<HTMLElement>('.skills i')].forEach((bar, b) => {
					if (bar.className && n++ % 2 === 0) sounds.tick(parseFloat(bar.style.height) / 100 || 0, (b * BAR_GAP + BAR_GROW * 0.7) / 1000);
				});
				window.setTimeout(() => r.classList.replace('growing', 'grown'), 9 * BAR_GAP + BAR_GROW + 50);
			}, () => setOf(grown, list).delete(key));
		}
	};
	const seen = new IntersectionObserver((entries) => {
		const rows = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement)
			.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
		for (const row of rows) seen.unobserve(row);
		if (rows.length) show(rows);
	}, { threshold: 0.5 });
	/** Watch a list's rows: those still to flash or grow wait until they're in view; grown bars show at once. */
	const watch = (list: HTMLElement) => {
		if (!on()) return;
		const name = list.dataset.list ?? '', done = setOf(grown, name), lit = setOf(flashed, name), flashes = anim('flash') && FLASH_LISTS.test(name);
		for (const row of list.querySelectorAll<HTMLElement>('.row[data-key]')) {
			if (pending.has(row) || row.classList.contains('growing')) continue;
			const key = row.dataset.key ?? '', bars = anim('bars') && row.querySelector('.skills') !== null;
			const toGrow = bars && !done.has(key);
			if (bars && !toGrow) { row.classList.remove('wait'); row.classList.add('grown'); }
			if (toGrow) row.classList.add('wait');
			if (toGrow || (flashes && !lit.has(key))) seen.observe(row);
		}
	};
	/** The page changed: turns not come yet are undone (their rows wait again, and are watched again when shown). */
	const unqueue = () => {
		for (const p of pending.values()) { for (const t of p.timers) window.clearTimeout(t); for (const u of p.undo) u(); }
		pending.clear();
		seen.disconnect();
		flashSlot = barSlot = 0;
	};
	/** Back after 5 minutes away: every map flashes and grows again. */
	let shownLists: HTMLElement[] = [];
	const again = () => {
		unqueue();
		flashed.clear();
		grown.clear();
		for (const row of root.querySelectorAll<HTMLElement>('[data-list] .row.grown, [data-list] .row.growing')) row.classList.remove('grown', 'growing');
		for (const list of shownLists) watch(list);
	};
	const AWAY = 5 * 60e3;
	let awaySince = 0;
	const onVisibility = () => {
		if (document.hidden) awaySince ||= Date.now();
		else if (!win.hidden) { if (awaySince && Date.now() - awaySince >= AWAY) again(); awaySince = 0; }
	};
	document.addEventListener('visibilitychange', onVisibility);
	/** ADHD Mode (or its flashes or bars) turned on or off: start over, nothing waits. */
	const stopAll = () => {
		unqueue();
		flashed.clear();
		grown.clear();
		for (const row of root.querySelectorAll('.row.wait, .row.growing, .row.grown')) row.classList.remove('wait', 'growing', 'grown');
	};

	// ---- a list drawn again: new plays and changed maps ----
	const cellsOf = (r: Element) => [...r.children].filter((c) => !c.matches('.flash, .float, .shine'));
	const snapshots = new Map<string, { rows: Map<string, string[]>, top: string }>();
	const snapshot = (list: HTMLElement) => ({
		rows: new Map([...list.querySelectorAll<HTMLElement>('.row[data-key]')].map((r) => [r.dataset.key!, cellsOf(r).map((c) => c.textContent ?? '')])),
		top: list.querySelector<HTMLElement>('.row[data-key]')?.dataset.key ?? '',
	});
	/** A number counts up to its value, keeping how it's written (1.2K, 300, 3.1K ↑). */
	const countUp = (el: HTMLElement) => {
		const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(el.textContent ?? '');
		if (!m || reducedMotion()) return;
		const to = parseFloat(m[2]!.replace(/,/g, '')), dp = (m[2]!.split('.')[1] ?? '').length, t0 = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - t0) / 500);
			el.textContent = m[1]! + (to * ease(t)).toFixed(dp) + m[3]!;
			if (t < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	};
	let lastPlaySound = 0;
	const isTime = (t: string) => /ago|now/.test(t);
	/** After a list is drawn again for new plays (not when a page opens): rows that are new or changed flash in their
	 *  top skill's colour, changed numbers count up and pop, the XP the play gave floats up, and a new first place
	 *  shines (with the new plays animation on); the chime or the cash register plays. */
	const changed = (list: HTMLElement) => {
		const name = list.dataset.list ?? '', was = snapshots.get(name), now = snapshot(list);
		snapshots.set(name, now);
		if (!on() || !was?.rows.size) return;
		// new plays don't flash in like maps coming into view: they have their own effect
		for (const key of now.rows.keys()) if (!was.rows.has(key)) setOf(flashed, name).add(key);
		const moves = anim('plays');
		const rows = [...list.querySelectorAll<HTMLElement>('.row[data-key]')].filter((r) => {
			const old = was.rows.get(r.dataset.key!), cells = now.rows.get(r.dataset.key!)!;
			return !old || old.some((t, i) => t !== cells[i] && !isTime(t));
		}).slice(0, 5);
		if (!rows.length) return;
		// reads first (colours, positions), then writes
		const reads = rows.map((r) => {
			const sk = r.querySelector('[class*="sk-"]'), xp = cellsOf(r)[XP_COLUMN[name] ?? -1] as HTMLElement | undefined;
			return { r, colour: sk ? getComputedStyle(sk).backgroundColor : 'var(--accent)', left: xp?.offsetLeft ?? 0, xp: (xp?.textContent ?? '').replace(/[↑↓]/g, '').trim() };
		});
		for (const { r, colour, left, xp } of moves ? reads : []) {
			const old = was.rows.get(r.dataset.key!);
			r.style.setProperty('--c', colour);
			r.insertAdjacentHTML('beforeend', `${r.querySelector(':scope > .flash') ? '' : '<i class="flash"></i>'}${/\d/.test(xp) ? `<span class="float" style="left:${left}px">+${xp}</span>` : ''}`);
			r.querySelector(':scope > .float')?.addEventListener('animationend', (e) => (e.target as Element).remove(), { once: true });
			if (!old && name === 'plays') replay(r, 'arrive');
			if (old) cellsOf(r).forEach((cell, i) => {
				const text = cell.textContent ?? '';
				if (old[i] === text || !/\d/.test(text) || isTime(text) || cell.children.length > 1) return;
				cell.innerHTML = `<span class="bump">${cell.innerHTML}</span>`;
				countUp(cell.firstElementChild as HTMLElement);
			});
			replay(r, 'gain');
		}
		// a different map in first place in Effective Maps (the same map, at any rate, beating its own play doesn't
		// count): it shines, and the cash register plays instead of the chime
		const first = list.querySelector<HTMLElement>('.row[data-key]');
		const mapOf = (key: string) => key.split('@')[0];
		const newTop = name === 'best' && first !== null && mapOf(now.top) !== mapOf(was.top);
		if (newTop && moves) {
			first.insertAdjacentHTML('beforeend', '<i class="shine"></i>');
			window.setTimeout(() => first.querySelector(':scope > .shine')?.remove(), 1200);
		}
		// one sound per refresh, whichever lists show it
		if (performance.now() - lastPlaySound > 1000 || newTop) {
			lastPlaySound = performance.now();
			const text = reads[0]!.r.textContent ?? '';
			if (newTop) sounds.best(); else sounds.play(text.includes('↑') ? 'up' : text.includes('↓') ? 'down' : '');
		}
	};

	let animsWere = '';
	return {
		/** The settings changed (or the look was applied again). */
		apply: () => {
			const o = options();
			for (const id of ANIMS) win.classList.toggle(`a-${id}`, o.on && o.anims[id]);
			win.classList.toggle('juice', o.on);
			// ADHD Mode, its flashes or its bars turned on or off: start over
			const now = `${o.on}${o.anims.flash}${o.anims.bars}`;
			if (now !== animsWere) { const first = !animsWere; animsWere = now; stopAll(); if (!first) for (const list of shownLists) watch(list); }
			if (anim('switches')) requestAnimationFrame(pills);
		},
		/** A page was opened (or the window): its cards and first rows rise in; maps not flashed or grown yet do that as
		 *  they come into view. */
		viewShown: (lists: HTMLElement[]) => {
			shownLists = lists;
			if (!on()) return;
			unqueue();
			if (anim('switches')) requestAnimationFrame(pills);
			if (anim('pages')) {
				[...root.querySelectorAll('.panels > .card:not([hidden])')].forEach((c, i) => { (c as HTMLElement).style.setProperty('--i', String(i)); replay(c, 'enter'); });
				for (const list of lists) {
					[...list.querySelectorAll<HTMLElement>(':scope > .row:not(.head-row), :scope > .skill-group')].slice(0, 15).forEach((r, i) => r.style.setProperty('--i', String(i)));
					replay(list, 'enter-rows', 1000);
				}
			}
			// after the rows have risen in
			flashSlot = barSlot = performance.now() + VIEW_DELAY;
			for (const list of lists) watch(list);
		},
		/** A list was drawn: after new plays were read (`news`, compared with what it showed), or for anything else (a
		 *  page opened, a setting changed: only noted, so the next new play compares with it). */
		drawn: (list: HTMLElement, news: boolean) => {
			if (news) changed(list); else snapshots.set(list.dataset.list ?? '', snapshot(list));
			watch(list);
		},
		/** Rows were added (the next 50 Recent plays), or a list drawn that isn't compared (the Strain tab's). `fresh`
		 *  (a new Strain pick): its maps flash and grow again. */
		added: (list: HTMLElement, fresh = false) => {
			if (fresh) { flashed.delete(list.dataset.list ?? ''); grown.delete(list.dataset.list ?? ''); }
			watch(list);
		},
		/** The window opened. */
		opened: () => {
			// away 5 minutes or more: every map flashes and grows again
			if (awaySince && Date.now() - awaySince >= AWAY) again();
			awaySince = 0;
			if (on()) sounds.open();
			if (anim('window')) replay(win, 'open', 400);
		},
		/** The window is closing: `done` hides it, after a short fade with that animation on. */
		closing: (done: () => void) => {
			awaySince = Date.now();
			if (!anim('window') || reducedMotion()) { done(); return; }
			win.classList.add('closing');
			window.setTimeout(() => { win.classList.remove('closing'); done(); }, 150);
		},
		/** A row was opened: its breakdown rises in and its bars fill. */
		rowOpened: (detail: Element) => { if (anim('rows')) replay(detail, 'enter', 600); },
		/** Advanced mode copied a play. */
		copied: () => sounds.copy(),
		/** A map that gives accuracy XP: its row flashes in rainbow colours, `message` pops up above it, and confetti
		 *  bursts from it (from the window's top when it isn't on screen), with a party popper and horn. Whether
		 *  anything played (ADHD Mode on, and the confetti or its sounds on). */
		surprise: (beatmapId: number, message: string): boolean => {
			const o = options();
			if (!o.on || (!o.anims.confetti && !o.sounds.surprise && !o.sounds.horn)) return false;
			sounds.surprise();
			if (!o.anims.confetti || reducedMotion()) return true;
			// read where it starts, then write the pieces
			const row = [...root.querySelectorAll<HTMLElement>(`.row[data-play$=":${beatmapId}"]`)].find((r) => r.offsetParent !== null);
			const box = win.getBoundingClientRect(), from = row?.getBoundingClientRect();
			const x = from ? from.left - box.left + Math.min(from.width / 2, 240) : box.width / 2, y = from ? from.top - box.top + from.height / 2 : 60;
			if (row) {
				row.insertAdjacentHTML('beforeend', '<i class="party"></i>');
				window.setTimeout(() => row.querySelector(':scope > .party')?.remove(), 2600);
			}
			const note = document.createElement('div');
			note.className = 'party-note';
			note.textContent = message;
			note.style.top = `${Math.max(8, (from ? from.top - box.top : 60) - 40)}px`;
			win.append(note);
			window.setTimeout(() => note.remove(), 4200);
			const layer = document.createElement('div');
			layer.className = 'confetti';
			layer.innerHTML = Array.from({ length: 48 }, () => {
				const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, speed = 140 + Math.random() * 220;
				const dx = Math.cos(angle) * speed, dy = Math.sin(angle) * speed;
				// it falls slowly to below the start, swaying (--sw, --s) and flipping (--f) on the way
				const style = `left:${x}px;top:${y}px;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--fall:${(240 + Math.random() * 200).toFixed(0)}px;--d:${(2.6 + Math.random() * 1).toFixed(2)}s;--sw:${(8 + Math.random() * 14).toFixed(0)}px;--s:${(0.5 + Math.random() * 0.5).toFixed(2)}s;--f:${(0.3 + Math.random() * 0.4).toFixed(2)}s`;
				return `<i style="${style}"><b style="background:${CONFETTI[Math.floor(Math.random() * CONFETTI.length)]};animation-delay:-${(Math.random()).toFixed(2)}s"></b></i>`;
			}).join('');
			win.append(layer);
			window.setTimeout(() => layer.remove(), 3800);
			return true;
		},
		/** The bars' tick at full height, to hear the volume. */
		sample: () => sounds.tick(1, 0),
		dispose: () => { stopAll(); document.removeEventListener('visibilitychange', onVisibility); root.removeEventListener('pointerdown', onPress); root.removeEventListener('toggle', onToggle, true); void audio?.close(); },
	};
};
