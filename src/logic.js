// The tracker's rules, with no DOM and no game: which plays are 7K, each play's XP, and which maps give the most XP
// per minute. Plain JavaScript so the tests can run it directly (npm test).

/** 7K's skills, as the game names them (oss!idle shared/rulesets/mania/7k/skills.ts). */
export const SKILLS_7K = /** @type {const} */ (['accuracy', 'speed', 'stamina', 'jacks', 'independence', 'ln', 'technical', 'focus', 'sv', 'memory']);
/** Skills only 7K has: a play that gave any of them was a 7K play. */
export const ONLY_7K = ['jacks', 'independence', 'ln', 'technical', 'focus', 'sv'];

/**
 * @typedef {Record<string, number>} Gains  XP per skill
 * @typedef {{ title: string, difficulty: string, keys: number, lengthSec: number }} MapInfo
 * @typedef {{ beatmapId: number, playedAt: number, rate: number, mods: string, gains: Gains, info: MapInfo | undefined, total: number }} Play
 * @typedef {{ beatmapId: number, rate: number, info: MapInfo | undefined, n: number, nXp: number, xp: number, gains: Gains, lastAt: number, last: Gains, lastXp: number, prevAt: number, prevXp: number, perPlay: number, perMinute: number }} MapStats
 */

/** @param {unknown} v */
export const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

/** A play's gains as the game stores them (JSON text), or nothing. @param {unknown} text @returns {Gains} */
export const parseGains = (text) => {
	try {
		const g = JSON.parse(typeof text === 'string' && text ? text : '{}');
		return g && typeof g === 'object' ? g : {};
	} catch {
		return {};
	}
};

/** @param {Gains} gains */
export const totalOf = (gains) => SKILLS_7K.reduce((t, sk) => t + num(gains[sk]), 0);

/** A map plays in one mode: 7K when the catalogue gives it 7 keys; for a map it doesn't know, when the XP has a
 *  7K-only skill. @param {MapInfo | undefined} info @param {Gains} gains */
export const is7kPlay = (info, gains) => (info ? info.keys === 7 : ONLY_7K.some((sk) => num(gains[sk]) > 0));

/**
 * The maps played, best first: XP per minute of play (the map's length at the play's rate). The same map at another
 * rate is its own entry. Maps with no known length go after, by XP per play; maps that gave no XP are left out.
 * The averages use only each map's latest `avgOf` plays with XP.
 * @param {Play[]} plays
 * @param {number} [avgOf]
 * @returns {MapStats[]}
 */
export const bestMaps = (plays, avgOf = Infinity) => {
	/** @type {Map<string, { m: Omit<MapStats, 'perPlay' | 'perMinute'>, withXp: Play[] }>} */
	const byMap = new Map();
	for (const p of plays) {
		const rate = num(p.rate) || 1;
		const key = `${p.beatmapId}@${rate}`;
		const entry = byMap.get(key) || { m: { beatmapId: p.beatmapId, rate, info: p.info, n: 0, nXp: 0, xp: 0, gains: {}, lastAt: -1, last: {}, lastXp: 0, prevAt: -1, prevXp: 0 }, withXp: [] };
		entry.m.n++;
		// a play saved without XP (not written yet, or none given) counts as played, but not in the averages or as
		// the latest play
		if (p.total > 0) entry.withXp.push(p);
		byMap.set(key, entry);
	}
	const out = [];
	for (const { m, withXp } of byMap.values()) {
		if (!withXp.length) continue;
		// newest first: the latest play, the one before it (is the map giving less XP?), and the averages from only
		// the latest `avgOf` plays, so old plays that gave far more don't keep a map on top
		withXp.sort((a, b) => b.playedAt - a.playedAt);
		const latest = /** @type {Play} */ (withXp[0]), before = withXp[1];
		m.lastAt = latest.playedAt; m.last = latest.gains; m.lastXp = latest.total;
		if (before) { m.prevAt = before.playedAt; m.prevXp = before.total; }
		const used = withXp.slice(0, Math.max(1, avgOf));
		m.nXp = used.length;
		for (const p of used) {
			m.xp += p.total;
			for (const sk of SKILLS_7K) m.gains[sk] = (m.gains[sk] || 0) + num(p.gains[sk]);
		}
		const minutes = m.info && m.info.lengthSec > 0 ? m.info.lengthSec / m.rate / 60 : 0;
		out.push({ ...m, perPlay: m.xp / m.nXp, perMinute: minutes ? m.xp / m.nXp / minutes : 0 });
	}
	return out.sort((a, b) => (b.perMinute - a.perMinute) || (b.perPlay - a.perPlay));
};

/** 18400 → "18.4K". @param {number} n */
export const xpText = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

/** Milliseconds ago as "just now", "2m ago", "3h ago", "2d ago". @param {number} ms */
export const agoText = (ms) => {
	const m = Math.floor(ms / 60000);
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

/**
 * For each 7K skill, the maps that gave it the most XP per minute of play (each map's average per play); maps with no
 * known length go after, by XP per play. Skills no map trained are left out.
 * @param {MapStats[]} maps @param {number} [count]
 * @returns {{ skill: string, maps: { map: MapStats, perMinute: number, perPlay: number }[] }[]}
 */
export const bestBySkill = (maps, count = 5) => SKILLS_7K.map((skill) => ({
	skill,
	maps: maps.map((m) => {
		const perPlay = num(m.gains[skill]) / m.nXp;
		return { map: m, perPlay, perMinute: m.perPlay > 0 ? m.perMinute * (perPlay / m.perPlay) : 0 };
	}).filter((x) => x.perPlay > 0)
		.sort((a, b) => (b.perMinute - a.perMinute) || (b.perPlay - a.perPlay))
		.slice(0, count),
})).filter((s) => s.maps.length > 0);
