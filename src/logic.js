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
 * @typedef {{ beatmapId: number, rate: number, info: MapInfo | undefined, n: number, xp: number, gains: Gains, lastAt: number, last: Gains, lastXp: number, perPlay: number, perMinute: number }} MapStats
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
 * @param {Play[]} plays
 * @returns {MapStats[]}
 */
export const bestMaps = (plays) => {
	/** @type {Map<string, Omit<MapStats, 'perPlay' | 'perMinute'>>} */
	const byMap = new Map();
	for (const p of plays) {
		const rate = num(p.rate) || 1;
		const key = `${p.beatmapId}@${rate}`;
		const m = byMap.get(key) || { beatmapId: p.beatmapId, rate, info: p.info, n: 0, xp: 0, gains: {}, lastAt: -1, last: {}, lastXp: 0 };
		m.n++;
		m.xp += p.total;
		// the latest play on it, whatever order the plays come in
		if (p.playedAt > m.lastAt) { m.lastAt = p.playedAt; m.last = p.gains; m.lastXp = p.total; }
		for (const sk of SKILLS_7K) m.gains[sk] = (m.gains[sk] || 0) + num(p.gains[sk]);
		byMap.set(key, m);
	}
	return [...byMap.values()].filter((m) => m.xp > 0).map((m) => {
		const minutes = m.info && m.info.lengthSec > 0 ? m.info.lengthSec / m.rate / 60 : 0;
		return { ...m, perPlay: m.xp / m.n, perMinute: minutes ? m.xp / m.n / minutes : 0 };
	}).sort((a, b) => (b.perMinute - a.perMinute) || (b.perPlay - a.perPlay));
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
