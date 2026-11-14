// The tracker's lists as HTML: a row per play or per map, each followed by its (closed) XP-per-skill breakdown.
// Every text that comes from data is escaped.

import { type Gains, type MapInfo, type MapStats, type Play, SKILLS_7K, agoText, num, totalOf, xpText } from './logic.js';
import type { SkillsAs, Unit } from './settings.js';
import { TEXT } from './text.js';

export const SKILL_COLORS: Record<string, string> = {
	accuracy: '#ff66aa', speed: '#4f9cf5', stamina: '#5fc3c0', jacks: '#f0883e', independence: '#a3e635',
	ln: '#c084fc', technical: '#e8c147', focus: '#7dd3fc', sv: '#fb7185', memory: '#94a3b8',
};

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

const mapCell = (info: MapInfo | undefined, beatmapId: number) => {
	const title = info ? info.title : TEXT.map(beatmapId);
	return `<span class="map" title="${esc(info ? `${info.title} [${info.difficulty}]` : title)}"><span>${esc(title)}</span><span class="muted">${esc(info?.difficulty ?? '')}</span></span>`;
};

/** The skills column: a bar of every skill's share, or the (up to) 3 that gave the most XP. */
const skillsCell = (gains: Gains, as: SkillsAs) => {
	const total = totalOf(gains);
	const parts = total > 0 ? SKILLS_7K.filter((sk) => num(gains[sk]) > 0) : [];
	if (as === 'top') {
		// up to 2, and only those with a real share (15% or more); the biggest one always shows
		const top = parts.sort((a, b) => num(gains[b]) - num(gains[a])).filter((sk, i) => i === 0 || num(gains[sk]) / total >= TOP_SHARE).slice(0, 2);
		return `<span class="top-skills">${top.map((sk) => `<span>${skillName(sk)}</span>`).join('')}</span>`;
	}
	return `<span class="skills">${parts.map((sk) => `<i style="width:${(num(gains[sk]) / total) * 100}%;background:${SKILL_COLORS[sk]}" title="${skillName(sk)}: ${xpText(num(gains[sk]))}"></i>`).join('')}</span>`;
};

/** The Skills box: which colour is which skill. */
export const legendHtml = (): string => SKILLS_7K.map((sk) => `<span><i style="background:${SKILL_COLORS[sk]}"></i>${skillName(sk)}</span>`).join('');

/** Under a clicked row: the total, then each skill's XP (per play on average for a map), biggest first, with its share. */
const breakdown = (gains: Gains, per = 1, label = '') => {
	const total = totalOf(gains) / per;
	const parts = SKILLS_7K.map((sk): [string, number] => [sk, num(gains[sk]) / per]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
	const lines = parts.map(([sk, v]) => `<div class="skill-line">
		<span>${skillName(sk)}</span>
		<span class="share"><i style="transform:scaleX(${total ? v / total : 0});background:${SKILL_COLORS[sk]}"></i></span>
		<span class="num">${xpText(v)}</span><span class="muted num">${total ? Math.round((v / total) * 100) : 0}%</span>
	</div>`).join('');
	const totalLine = total > 0 ? `<div class="skill-line total"><span>${TEXT.total}</span><span></span><span class="num">${xpText(total)}</span><span class="muted num">100%</span></div>` : '';
	return `<div class="detail" hidden>${label ? `<div class="muted detail-label">${esc(label)}</div>` : ''}${totalLine}${lines || `<div class="muted">${TEXT.noXp}</div>`}</div>`;
};

const ROW = 'class="row" role="button" tabindex="0" aria-expanded="false"';

export const playsHtml = (plays: Play[], now: number, as: SkillsAs): string => {
	if (!plays.length) return `<div class="empty">${TEXT.noPlays}</div>`;
	const c = TEXT.cols;
	return `<div class="row head-row"><span>${c.when}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.xp}</span><span>${c.skills}</span></div>${plays.map((p) => {
		const mods = String(p.mods).replace(/[[\]",]/g, ' ').trim();
		return `<div ${ROW}>
			<span class="muted">${agoText(now - p.playedAt)}</span>
			${mapCell(p.info, p.beatmapId)}
			<span>${rateText(p.rate)} <span class="muted">${esc(mods)}</span></span>
			<span>${p.total > 0 ? xpText(p.total) : '<span class="muted">–</span>'}</span>
			${skillsCell(p.gains, as)}
		</div>${breakdown(p.gains)}`;
	}).join('')}`;
};

export const bestHtml = (maps: MapStats[], unit: Unit, as: SkillsAs): string => {
	if (!maps.length) return `<div class="empty">${TEXT.noBest}</div>`;
	const c = TEXT.cols;
	return `<div class="row head-row"><span>${c.number}</span><span>${c.map}</span><span>${c.rate}</span><span>${c.plays}</span><span>${c.totalXp}</span><span>${TEXT.units[unit]}</span><span>${c.skills}</span></div>${maps.map((m, i) => `<div ${ROW}>
		<span class="muted">${i + 1}</span>
		${mapCell(m.info, m.beatmapId)}
		<span class="muted">${rateText(m.rate)}</span>
		<span class="muted">${m.n}</span>
		<span>${xpText(m.xp)}</span>
		<span class="strong">${m.perMinute ? rateXp(m.perMinute, unit) : '<span class="muted">–</span>'}</span>
		${skillsCell(m.gains, as)}
	</div>${breakdown(m.gains, m.n, m.n > 1 ? TEXT.average(m.n) : '')}`).join('')}`;
};

export const messageHtml = (text: string, error = false) => `<div class="empty${error ? ' error' : ''}">${esc(text)}</div>`;
