// The tracker's lists as HTML: a row per play or per map, each followed by its (closed) XP-per-skill breakdown.
// Every text that comes from data is escaped.

import { type Gains, type MapInfo, type MapStats, type Play, SKILLS_7K, agoText, bestBySkill, num, totalOf, xpText } from '../rules/logic.js';
import { strainOf } from '../game/data.js';
import type { SkillsAs, StrainAs, Unit } from '../settings.js';
import { arrowsOf } from '../rules/strain.js';
import { TEXT } from './text.js';

// Each skill's colour is a class (sk-speed, …) in styles.css; only sizes that come from data are inline.

export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
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

/** The skills column: a bar for each skill's XP, or the (up to) 2 that gave the most XP, each in its colour. */
const skillsCell = (gains: Gains, as: SkillsAs) => {
	const total = totalOf(gains);
	const parts = total > 0 ? SKILLS_7K.filter((sk) => num(gains[sk]) > 0) : [];
	if (as === 'top') {
		// up to 2, and only those with a real share (15% or more); the biggest one always shows
		const top = parts.sort((a, b) => num(gains[b]) - num(gains[a])).filter((sk, i) => i === 0 || num(gains[sk]) / total >= TOP_SHARE).slice(0, 2);
		return `<span class="top-skills">${top.map((sk) => `<span class="tx-${sk}">${skillName(sk)}</span>`).join('')}</span>`;
	}
	// a bar per skill, always in the same order, as tall as its XP against the skill that got the most
	const most = Math.max(0, ...parts.map((sk) => num(gains[sk])));
	return `<span class="skills">${SKILLS_7K.map((sk) => {
		const v = num(gains[sk]);
		return v > 0 ? `<i class="sk-${sk}" style="height:${(v / most) * 100}%" title="${skillName(sk)}: ${xpText(v)}"></i>` : `<i title="${skillName(sk)}: 0"></i>`;
	}).join('')}</span>`;
};

/** The Skills box: which colour is which skill. */
export const legendHtml = (): string => SKILLS_7K.map((sk) => `<button type="button" class="legend-skill" data-skill="${sk}" aria-pressed="true" title="${TEXT.hideSkill(skillName(sk))}"><i class="dot sk-${sk}"></i>${skillName(sk)}</button>`).join('');

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

/** XP per time, from red (the list's worst) through orange and yellow to green (its best): the tracker's colours,
 *  blended between the two nearest. Gray rows don't count and stay gray. */
const GRADE = [[248, 113, 113], [240, 136, 62], [232, 193, 71], [74, 222, 128]];
const gradeOf = (values: number[]) => {
	const shown = values.filter((v) => v > 0), lo = Math.min(...shown), hi = Math.max(...shown);
	return (v: number): string => {
		const x = (hi > lo ? (v - lo) / (hi - lo) : 1) * (GRADE.length - 1), i = Math.min(GRADE.length - 2, Math.floor(x)), f = x - i;
		return `rgb(${GRADE[i]!.map((c, n) => Math.round(c + (GRADE[i + 1]![n]! - c) * f)).join(',')})`;
	};
};
/** An XP per time cell, in its colour from `grade` (none when the row is gray). */
const rateCell = (perMinute: number, unit: Unit, grade?: (v: number) => string) =>
	(perMinute ? `<span class="strong"${grade ? ` style="color:${grade(perMinute)}"` : ''}>${rateXp(perMinute, unit)}</span>` : '<span class="strong"><span class="muted">–</span></span>');

/** The strain bar's zones and colours, as Queue Helper draws them: Cold, Warming, Peak, Pushing, Fatigued. */
const ZONES: [to: number, color: string][] = [[0.2, '#4f9cf5'], [0.4, '#5fc3c0'], [0.6, '#e8c147'], [0.8, '#f0883e'], [Infinity, '#c084fc']];
/** What the Strain column shows (a setting): set before the lists are drawn. */
let strainAs: StrainAs = 'bar';
export const showStrainAs = (as: StrainAs): void => { strainAs = as; };

/** A play's strain, with the arrows for how it moved it (› straining, orange; ‹ resting, blue) either side: the
 *  strain bar after it in its zone's colour, as Queue Helper shows it, or the strain minutes it added (+) or rested
 *  (−) per minute of the map. The value stays in the middle of the column. */
const strainCells = (playedAt: number, arrowsOnly = false, v?: number) => {
	const x = v === undefined ? strainOf(playedAt) : { v };
	if (arrowsOnly) {
		const n = x?.v === undefined ? undefined : arrowsOf(x.v);
		if (!n) return `<span class="strain"><span></span><span class="muted" title="${n === undefined ? TEXT.noStrain : TEXT.arrowsHelp}">–</span><span></span></span>`;
		return `<span class="strain" title="${TEXT.arrowsHelp}"><span></span><span class="arrows-only ${n > 0 ? 'warm' : 'cool'}">${(n > 0 ? '›' : '‹').repeat(Math.abs(n))}</span><span></span></span>`;
	}
	const shown = strainAs === 'bar' ? x?.bar : x?.v;
	if (shown === undefined) return `<span class="strain"><span></span><span class="muted" title="${TEXT.noStrain}">–</span><span></span></span>`;
	const arrows = x?.v === undefined ? 0 : arrowsOf(x.v);
	let value;
	if (strainAs === 'bar') value = `<span style="color:${ZONES.find(([to]) => shown < to)![1]}">${Math.round(shown * 100)}%</span>`;
	else {
		// signed only when it shows as more than 0.0
		const v = Math.round(shown * 10) / 10;
		value = `<span class="${arrows > 0 ? 'warm' : arrows < 0 ? 'cool' : 'muted'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}</span>`;
	}
	return `<span class="strain" title="${strainAs === 'bar' ? TEXT.barHelp : TEXT.strainHelp}"><span class="arrows cool">${arrows < 0 ? '‹'.repeat(-arrows) : ''}</span>${value}<span class="arrows warm">${arrows > 0 ? '›'.repeat(arrows) : ''}</span></span>`;
};

/** The plays Recent plays lists: all of them, or with `only`, just that map's plays since `since`. */
export const listedPlays = (all: Play[], since: number, only: number, keep?: (p: Play) => boolean): Play[] => {
	const mine = only ? all.filter((p) => p.beatmapId === only && p.playedAt >= since) : all;
	return keep ? mine.filter(keep) : mine;
};

/** Recent plays, `count` rows from `start` (the head row with the first batch); a play older than `since` is grayed out. */
export const playsHtml = (all: Play[], now: number, unit: Unit, as: SkillsAs, since = 0, staleText = '', only = 0, empty: string = TEXT.noPlays, start = 0, count = Infinity, keep?: (p: Play) => boolean): string => {
	// each play's XP against the play before it on the same map and rate (newest first, so walk from the oldest)
	const before = new Map<Play, number>(), last = new Map<string, number>();
	for (let i = all.length - 1; i >= 0; i--) {
		const p = all[i]!, key = `${p.beatmapId}@${num(p.rate) || 1}`;
		if (p.total <= 0) continue;
		before.set(p, last.get(key) ?? 0);
		last.set(key, p.total);
	}
	const listed = listedPlays(all, since, only, keep);
	if (!listed.length) return start ? '' : `<div class="empty">${esc(empty)}</div>`;
	const plays = listed.slice(start, start + count);
	// how many times each map was played, at any rate
	const timesPlayed = new Map<number, number>();
	for (const p of all) timesPlayed.set(p.beatmapId, (timesPlayed.get(p.beatmapId) ?? 0) + 1);
	const c = TEXT.cols;
	// the play's XP over its length (the map's length at the play's rate)
	const perMinuteOf = (p: Play) => {
		const minutes = p.info && p.info.lengthSec > 0 ? p.info.lengthSec / (num(p.rate) || 1) / 60 : 0;
		return p.total > 0 && minutes ? p.total / minutes : 0;
	};
	// coloured against the plays not grayed out, in the whole list (not only this batch)
	const grade = gradeOf(listed.filter((p) => p.playedAt >= since).map(perMinuteOf));
	return `${start ? '' : `<div class="row head-row"><span>${c.when}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.plays}</span><span>${c.xp}</span><span>${TEXT.units[unit]}</span><span>${c.strain}</span><span>${c.skills}</span></div>`}${plays.map((p) => {
		const mods = String(p.mods).replace(/[[\]",]/g, ' ').trim();
		return `<div ${row(`${p.playedAt}:${p.beatmapId}`, p.playedAt < since ? staleText : '')}>
			<span class="muted">${agoText(now - p.playedAt)}</span>
			${mapCell(p.info, p.beatmapId, mods)}
			<span class="muted">${rateText(p.rate)}</span>
			<span class="muted" title="${TEXT.playsOnMap}">${timesPlayed.get(p.beatmapId) ?? 1}</span>
			${p.total > 0 ? xpCell(p.total, before.get(p) ?? 0) : '<span><span class="muted">–</span></span>'}
			${rateCell(perMinuteOf(p), unit, p.playedAt < since ? undefined : grade)}
			${strainCells(p.playedAt)}
			${skillsCell(p.gains, as)}
		</div>${breakdown(p.gains, 1, '', only ? 0 : p.beatmapId)}`;
	}).join('')}`;
};

/** The most effective maps; a map not played since `since` (if given) is grayed out, with `staleText` as its tooltip. */
export const bestHtml = (maps: MapStats[], unit: Unit, as: SkillsAs, since = 0, staleText = '', empty: string = TEXT.noBest, arrowsOnly = false, vOf?: (m: MapStats) => number | undefined, plainXp = false): string => {
	if (!maps.length) return `<div class="empty">${esc(empty)}</div>`;
	const c = TEXT.cols;
	const grade = gradeOf(maps.filter((m) => m.lastAt >= since).map((m) => m.perMinute));
	return `<div class="row head-row"><span>${c.number}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.plays}</span><span>${c.totalXp}</span><span>${TEXT.units[unit]}</span><span>${c.strain}</span><span>${c.skills}</span></div>${maps.map((m, i) => `<div ${row(`${m.beatmapId}@${m.rate}`, m.lastAt < since ? staleText : '')}>
		<span class="muted">${i + 1}</span>
		${mapCell(m.info, m.beatmapId)}
		<span class="muted">${rateText(m.rate)}</span>
		<span class="muted">${m.n}</span>
		${xpCell(m.lastXp, plainXp ? 0 : m.prevXp)}
		${rateCell(m.perMinute, unit, m.lastAt < since ? undefined : grade)}
		${strainCells(m.lastAt, arrowsOnly, vOf?.(m))}
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
		<div class="row head-row"><span>${c.number}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.plays}</span><span>${c.perPlay}</span><span>${TEXT.units[unit]}</span><span>${c.strain}</span></div>
		${((grade) => top.map((x, i) => `<div class="row">
			<span class="muted">${i + 1}</span>
			<button type="button" class="map-link" data-only="${x.map.beatmapId}" title="${TEXT.onlyMap}">${mapCell(x.map.info, x.map.beatmapId, '', true)}</button>
			<span class="muted">${rateText(x.map.rate)}</span>
			<span class="muted">${x.map.n}</span>
			<span>${xpText(x.perPlay)}</span>
			${rateCell(x.perMinute, unit, grade)}
			${strainCells(x.map.lastAt)}
		</div>`).join(''))(gradeOf(top.map((x) => x.perMinute)))}
	</details>`).join('');
};

/** The changelog (CHANGELOG.md) as HTML: a box per version (the newest open), its kinds of change, and a line per change. */
export const changelogHtml = (md: string): string => {
	const out: string[] = [];
	let list = false, box = false;
	const close = () => { if (list) out.push('</ul>'); list = false; };
	for (const line of md.split('\n')) {
		const version = /^## \[(.+?)\](?: - (.+))?/.exec(line);
		if (version) {
			close();
			if (box) out.push('</div></details>');
			out.push(`<details class="log"${box ? '' : ' open'}><summary><span class="log-version">${esc(version[1])}</span><span class="muted">${esc(version[2] ?? '')}</span></summary><div class="log-body">`);
			box = true;
			continue;
		}
		const kind = /^### (.+)/.exec(line);
		if (kind) { close(); out.push(`<h4 class="log-kind">${esc(kind[1])}</h4>`); continue; }
		const item = /^- (.+)/.exec(line);
		if (item && box) { if (!list) out.push('<ul>'); list = true; out.push(`<li>${esc(item[1])}</li>`); }
	}
	close();
	if (box) out.push('</div></details>');
	return out.join('');
};

export const messageHtml =(text: string, error = false) => `<div class="empty${error ? ' error' : ''}">${esc(text)}</div>`;
