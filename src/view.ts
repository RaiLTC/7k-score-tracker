// The tracker's lists as HTML: a row per play or per map, each followed by its (closed) XP-per-skill breakdown.
// Every text that comes from data is escaped.

import { type Gains, type MapInfo, type MapStats, type Play, SKILLS_7K, agoText, bestBySkill, num, totalOf, xpText } from './logic.js';
import type { SkillsAs, Unit } from './settings.js';
import { TEXT } from './text.js';

// Each skill's colour is a class (sk-speed, …) in styles.css; only sizes that come from data are inline.

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const rateText = (rate: number) => String(num(rate) || 1);
const skillName = (sk: string) => TEXT.skills[sk] ?? sk;
/** The share a skill needs to show in the Top skills column. */
const TOP_SHARE = 0.15;
const PER_MINUTE: Record<Unit, number> = { h: 60, m: 1, s: 1 / 60 };
const rateXp = (perMinute: number, unit: Unit) => {
	const v = perMinute * PER_MINUTE[unit];
	return v < 10 ? v.toFixed(v < 1 ? 2 : 1) : xpText(v);
};

/** The map's title, and under it its difficulty (and the play's mods, if any). */
const mapCell = (info: MapInfo | undefined, beatmapId: number, mods = '', inline = false) => {
	const title = info ? info.title : TEXT.map(beatmapId);
	const sub = [info?.difficulty, mods].filter(Boolean).join(' · ');
	return `<span class="map${inline ? ' inline' : ''}" title="${esc(info ? `${info.title} [${info.difficulty}]` : title)}"><span>${esc(title)}</span><span class="muted">${esc(sub)}</span></span>`;
};

/** The skills column: a bar of every skill's share, or the (up to) 2 that gave the most XP, each in its colour. */
const skillsCell = (gains: Gains, as: SkillsAs) => {
	const total = totalOf(gains);
	const parts = total > 0 ? SKILLS_7K.filter((sk) => num(gains[sk]) > 0) : [];
	if (as === 'top') {
		// up to 2, and only those with a real share (15% or more); the biggest one always shows
		const top = parts.sort((a, b) => num(gains[b]) - num(gains[a])).filter((sk, i) => i === 0 || num(gains[sk]) / total >= TOP_SHARE).slice(0, 2);
		return `<span class="top-skills">${top.map((sk) => `<span class="tx-${sk}">${skillName(sk)}</span>`).join('')}</span>`;
	}
	return `<span class="skills">${parts.map((sk) => `<i class="sk-${sk}" style="width:${(num(gains[sk]) / total) * 100}%" title="${skillName(sk)}: ${xpText(num(gains[sk]))}"></i>`).join('')}</span>`;
};

/** The Skills box: which colour is which skill. */
export const legendHtml = (): string => SKILLS_7K.map((sk) => `<span><i class="dot sk-${sk}"></i>${skillName(sk)}</span>`).join('');

/** Under a clicked row: the total, then each skill's XP (for a map, its latest play), biggest first, with its share. */
const breakdown = (gains: Gains, per = 1, label = '', mapId = 0) => {
	const total = totalOf(gains) / per;
	const parts = SKILLS_7K.map((sk): [string, number] => [sk, num(gains[sk]) / per]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
	const lines = parts.map(([sk, v]) => `<div class="skill-line">
		<span>${skillName(sk)}</span>
		<span class="share"><i class="sk-${sk}" style="transform:scaleX(${total ? v / total : 0})"></i></span>
		<span class="num">${xpText(v)}</span><span class="muted num">${total ? Math.round((v / total) * 100) : 0}%</span>
	</div>`).join('');
	const totalLine = total > 0 ? `<div class="skill-line total"><span>${TEXT.total}</span><span></span><span class="num">${xpText(total)}</span><span class="muted num">100%</span></div>` : '';
	const only = mapId ? `<button type="button" class="btn small" data-only="${mapId}">${TEXT.onlyMap}</button>` : '';
	return `<div class="detail" hidden>${label ? `<div class="muted detail-label">${esc(label)}</div>` : ''}${totalLine}${lines || `<div class="muted">${TEXT.noXp}</div>`}${only}</div>`;
};

/** A clickable row; its key lets an open row stay open when the list is drawn again. */
const row = (key: string, stale = '') => `class="row${stale ? ' stale' : ''}" role="button" tabindex="0" aria-expanded="false" data-key="${esc(key)}"${stale ? ` title="${esc(stale)}"` : ''}`;

/** A map's latest XP is green when it gave more than the play before, red when less. Next to it: an arrow when it gave clearly less (or more) than the play before, 5% or more. */
const TREND_MIN = 0.05;
const trend = (latest: number, previous: number) => {
	if (previous <= 0) return '';
	const change = (latest - previous) / previous;
	if (Math.abs(change) < TREND_MIN) return '';
	const pct = Math.round(Math.abs(change) * 100);
	const [cls, arrow, text] = change < 0 ? ['down', '↓', TEXT.trendDown(pct)] : ['up', '↑', TEXT.trendUp(pct)];
	return ` <span class="trend ${cls}" title="${text}" aria-label="${text}">${arrow}</span>`;
};

/** A latest XP: green when it gave more than the play before, red when less, with the trend arrow. */
const xpCell = (latest: number, previous: number) =>
	`<span${previous > 0 && latest !== previous ? ` class="xp-${latest > previous ? 'up' : 'down'}"` : ''}>${xpText(latest)}${trend(latest, previous)}</span>`;

/** Recent plays; a play older than `since` is grayed out. With `only`, just that map's plays since then. */
export const playsHtml = (all: Play[], now: number, unit: Unit, as: SkillsAs, since = 0, staleText = '', only = 0, empty: string = TEXT.noPlays): string => {
	// each play's XP against the play before it on the same map and rate (newest first, so walk from the oldest)
	const before = new Map<Play, number>(), last = new Map<string, number>();
	for (let i = all.length - 1; i >= 0; i--) {
		const p = all[i]!, key = `${p.beatmapId}@${num(p.rate) || 1}`;
		if (p.total <= 0) continue;
		before.set(p, last.get(key) ?? 0);
		last.set(key, p.total);
	}
	const plays = only ? all.filter((p) => p.beatmapId === only && p.playedAt >= since) : all;
	if (!plays.length) return `<div class="empty">${esc(empty)}</div>`;
	const c = TEXT.cols;
	return `<div class="row head-row"><span>${c.when}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.xp}</span><span>${TEXT.units[unit]}</span><span>${c.skills}</span></div>${plays.map((p) => {
		// the play's XP over its length (the map's length at the play's rate)
		const minutes = p.info && p.info.lengthSec > 0 ? p.info.lengthSec / (num(p.rate) || 1) / 60 : 0;
		const mods = String(p.mods).replace(/[[\]",]/g, ' ').trim();
		return `<div ${row(`${p.playedAt}:${p.beatmapId}`, p.playedAt < since ? staleText : '')}>
			<span class="muted">${agoText(now - p.playedAt)}</span>
			${mapCell(p.info, p.beatmapId, mods)}
			<span>${rateText(p.rate)}</span>
			${p.total > 0 ? xpCell(p.total, before.get(p) ?? 0) : '<span><span class="muted">–</span></span>'}
			<span class="strong">${p.total > 0 && minutes ? rateXp(p.total / minutes, unit) : '<span class="muted">–</span>'}</span>
			${skillsCell(p.gains, as)}
		</div>${breakdown(p.gains, 1, '', only ? 0 : p.beatmapId)}`;
	}).join('')}`;
};

/** The most effective maps; a map not played since `since` (if given) is grayed out, with `staleText` as its tooltip. */
export const bestHtml = (maps: MapStats[], unit: Unit, as: SkillsAs, since = 0, staleText = '', empty: string = TEXT.noBest): string => {
	if (!maps.length) return `<div class="empty">${esc(empty)}</div>`;
	const c = TEXT.cols;
	return `<div class="row head-row"><span>${c.number}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.plays}</span><span>${c.totalXp}</span><span>${TEXT.units[unit]}</span><span>${c.skills}</span></div>${maps.map((m, i) => `<div ${row(`${m.beatmapId}@${m.rate}`, m.lastAt < since ? staleText : '')}>
		<span class="muted">${i + 1}</span>
		${mapCell(m.info, m.beatmapId)}
		<span class="muted">${rateText(m.rate)}</span>
		<span class="muted">${m.n}</span>
		${xpCell(m.lastXp, m.prevXp)}
		<span class="strong">${m.perMinute ? rateXp(m.perMinute, unit) : '<span class="muted">–</span>'}</span>
		${skillsCell(m.gains, as)}
	</div>${breakdown(m.last, 1, m.n > 1 ? TEXT.latest : '', m.beatmapId)}`).join('')}`;
};

/** The Skills tab: for each skill, the maps that gave it the most XP per minute of play. */
export const bySkillHtml = (maps: MapStats[], unit: Unit): string => {
	const groups = bestBySkill(maps);
	if (!groups.length) return `<div class="empty">${TEXT.noBest}</div>`;
	const c = TEXT.cols;
	// a closed block per skill (the browser's own <details>: no script), its best map named on the closed line
	return groups.map(({ skill, maps: top }) => `<details class="skill-group" data-key="${skill}">
		<summary class="skill-group-head"><i class="dot sk-${skill}"></i>${skillName(skill)}<span class="best-map">${esc(top[0]!.map.info?.title ?? TEXT.map(top[0]!.map.beatmapId))}<span class="diff">${esc(top[0]!.map.info?.difficulty ?? '')}</span></span></summary>
		<div class="row head-row"><span>${c.number}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.plays}</span><span>${c.perPlay}</span><span>${TEXT.units[unit]}</span></div>
		${top.map((x, i) => `<div class="row">
			<span class="muted">${i + 1}</span>
			<button type="button" class="map-link" data-only="${x.map.beatmapId}" title="${TEXT.onlyMap}">${mapCell(x.map.info, x.map.beatmapId, '', true)}</button>
			<span class="muted">${rateText(x.map.rate)}</span>
			<span class="muted">${x.map.n}</span>
			<span>${xpText(x.perPlay)}</span>
			<span class="strong">${x.perMinute ? rateXp(x.perMinute, unit) : '<span class="muted">–</span>'}</span>
		</div>`).join('')}
	</details>`).join('');
};

export const messageHtml =(text: string, error = false) => `<div class="empty${error ? ' error' : ''}">${esc(text)}</div>`;
