// The tracker's rules, with no DOM and no game: which plays are 7K, each play's XP, and which maps give the most XP
// per minute. Plain JavaScript so the tests can run it directly (npm test).

/** 7K's skills, as the game names them (oss!idle shared/rulesets/mania/7k/skills.ts). */
export const SKILLS_7K = /** @type {const} */ (['accuracy', 'speed', 'stamina', 'jacks', 'independence', 'ln', 'technical', 'focus', 'sv', 'memory']);
/** Skills only 7K has: a play that gave any of them was a 7K play. */
export const ONLY_7K = ['jacks', 'independence', 'ln', 'technical', 'focus', 'sv'];

/**
 * @typedef {Record<string, number>} Gains  XP per skill
 * @typedef {{ title: string, difficulty: string, keys: number, lengthSec: number, stars?: number, mapper?: string }} MapInfo
 * @typedef {{ beatmapId: number, playedAt: number, rate: number, mods: string, gains: Gains, info: MapInfo | undefined, total: number, pp?: number, xpSaved?: boolean, n?: number, acc?: number, misses?: number }} Play
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

/** How long a play with no XP waits for the game to write it before it counts as 0. */
export const XP_WAIT = 60e3;

/**
 * The maps played, best first: XP per minute of play (the map's length at the play's rate). The same map at another
 * rate is its own entry. Maps with no known length go after, by XP per play; maps that gave no XP are left out.
 * The averages use only each map's latest `avgOf` plays whose XP is known.
 * @param {Play[]} plays
 * @param {number} [avgOf]
 * @param {number} [now]
 * @returns {MapStats[]}
 */
export const bestMaps = (plays, avgOf = Infinity, now = Date.now()) => {
	/** @type {Map<string, { m: Omit<MapStats, 'perPlay' | 'perMinute'>, withXp: Play[] }>} */
	const byMap = new Map();
	for (const p of plays) {
		const rate = num(p.rate) || 1;
		const key = `${p.beatmapId}@${rate}`;
		const entry = byMap.get(key) || { m: { beatmapId: p.beatmapId, rate, info: p.info, n: 0, nXp: 0, xp: 0, gains: {}, lastAt: -1, last: {}, lastXp: 0, prevAt: -1, prevXp: 0 }, withXp: [] };
		entry.m.n++;
		// a play's XP is known once it has some, the game saved it as 0, or a minute has passed (the game writes it
		// shortly after the play): until then it counts as played, but not in the averages or as the latest play.
		// Known as 0, it's the latest like any other, so a map that gives nothing now drops out
		if (p.total > 0 || p.xpSaved || now - p.playedAt >= XP_WAIT) entry.withXp.push(p);
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
		if (!(m.xp > 0)) continue;
		const minutes = m.info && m.info.lengthSec > 0 ? m.info.lengthSec / m.rate / 60 : 0;
		out.push({ ...m, perPlay: m.xp / m.nXp, perMinute: minutes ? m.xp / m.nXp / minutes : 0 });
	}
	return out.sort((a, b) => (b.perMinute - a.perMinute) || (b.perPlay - a.perPlay));
};

/** @typedef {MapStats & { others: MapStats[] }} BestEver */
/**
 * All Time Highest: each map's best play ever, by XP per minute (at each rate apart): the map's best rate, with its
 * other rates in `others` (slowest first), maps best first. A play is a MapStats of one play (`n` counts every play
 * at that rate). Maps the catalogue has no length for go after, by XP.
 * @param {Play[]} plays
 * @returns {BestEver[]}
 */
export const allTimeBest = (plays) => {
	/** @type {Map<string, { n: number, best: Play | null, perMinute: number }>} */
	const byRate = new Map();
	for (const p of plays) {
		const rate = num(p.rate) || 1, key = `${p.beatmapId}@${rate}`;
		const e = byRate.get(key) || { n: 0, best: null, perMinute: 0 };
		// a row from All Time Highest's query stands for `n` plays
		e.n += num(p.n) || 1;
		const minutes = p.info && p.info.lengthSec > 0 ? p.info.lengthSec / rate / 60 : 0, perMinute = minutes ? p.total / minutes : 0;
		if (p.total > 0 && (!e.best || perMinute > e.perMinute || (perMinute === e.perMinute && p.total > e.best.total))) { e.best = p; e.perMinute = perMinute; }
		byRate.set(key, e);
	}
	/** @type {Map<number, MapStats[]>} */
	const byMap = new Map();
	for (const { n, best: p, perMinute } of byRate.values()) {
		if (!p) continue;
		const rate = num(p.rate) || 1;
		const m = { beatmapId: p.beatmapId, rate, info: p.info, n, nXp: 1, xp: p.total, gains: p.gains, lastAt: p.playedAt, last: p.gains, lastXp: p.total, prevAt: -1, prevXp: 0, perPlay: p.total, perMinute };
		byMap.set(p.beatmapId, [...(byMap.get(p.beatmapId) ?? []), m]);
	}
	const better = (/** @type {MapStats} */ a, /** @type {MapStats} */ b) => (b.perMinute - a.perMinute) || (b.perPlay - a.perPlay);
	return [...byMap.values()].map((rates) => {
		rates.sort(better);
		return { .../** @type {MapStats} */ (rates[0]), others: rates.slice(1).sort((a, b) => a.rate - b.rate) };
	}).sort(better);
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

/** @typedef {{ map: MapStats, perMinute: number, perPlay: number }} SkillMap */

/**
 * For each 7K skill, the maps that gave it the most XP per minute of play (each map's average per play); maps with no
 * known length go after, by XP per play. Skills no map trained are left out.
 * A map's rates are one entry, led (and ranked) by its rate with the most XP per minute among those played since
 * `since`, or, none played since then, by the rate played last; its other rates in `others`, slowest first.
 * With `out` (a map's outdated reason for the skill), rates outdated by a prestige lead only when none is current,
 * and maps outdated by one rank after the others (a level up only warns).
 * @param {MapStats[]} maps @param {number} [count] @param {number} [since]
 * @param {(m: MapStats, skill: string) => string} [out]
 * @returns {{ skill: string, maps: (SkillMap & { others: SkillMap[] })[] }[]}
 */
export const bestBySkill = (maps, count = 5, since = 0, out = () => '') => SKILLS_7K.map((skill) => {
	/** @type {Map<number, SkillMap[]>} */
	const byMap = new Map();
	for (const m of maps) {
		const perPlay = num(m.gains[skill]) / m.nXp;
		if (!(perPlay > 0)) continue;
		const rates = byMap.get(m.beatmapId) ?? [];
		rates.push({ map: m, perPlay, perMinute: m.perPlay > 0 ? m.perMinute * (perPlay / m.perPlay) : 0 });
		byMap.set(m.beatmapId, rates);
	}
	const rows = [...byMap.values()].map((rates) => {
		const fresh = (/** @type {SkillMap} */ x) => x.map.lastAt >= since;
		const current = (/** @type {SkillMap} */ x) => Number(out(x.map, skill) !== 'prestige');
		rates.sort((a, b) => (current(b) - current(a)) || (Number(fresh(b)) - Number(fresh(a))) || (fresh(a) ? b.perMinute - a.perMinute : b.map.lastAt - a.map.lastAt));
		return { .../** @type {SkillMap} */ (rates[0]), others: rates.slice(1).sort((a, b) => a.map.rate - b.map.rate) };
	});
	const current = (/** @type {SkillMap} */ x) => Number(out(x.map, skill) !== 'prestige');
	return { skill, maps: rows.sort((a, b) => (current(b) - current(a)) || (b.perMinute - a.perMinute) || (b.perPlay - a.perPlay)).slice(0, count) };
}).filter((s) => s.maps.length > 0);

// ---- search ----

/** @typedef {{ key: 'length' | 'skill' | 'stars', op: string, value: number | string }} SearchTag */
/** When a play was: `day`, the start of that day (ms); `ts` and `te`, minutes into the day. @typedef {{ day?: number, ts?: number, te?: number }} SearchTime */
/** @typedef {{ words: string[], tags: SearchTag[], time: SearchTime | null }} Search */

const TAG_KEYS = /** @type {Record<string, 'length' | 'skill' | 'stars'>} */ ({
	length: 'length', len: 'length', ln: 'length', skill: 'skill', skills: 'skill', sk: 'skill',
	'star-rating': 'stars', stars: 'stars', star: 'stars', sr: 'stars',
});

/** "90" or "90s" → 90, "1m30" or "1m30s" → 90, "2m" → 120; null when it isn't a length. @param {string} v */
export const lengthOf = (v) => {
	const m = /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(v.trim().toLowerCase());
	if (!m || (!m[1] && !m[2])) return null;
	return num(m[1]) * 60 + num(m[2]);
};

const TIME_KEYS = /** @type {Record<string, 'day' | 'ts' | 'te'>} */ ({ day: 'day', date: 'day', ts: 'ts', 'time-start': 'ts', te: 'te', 'time-end': 'te' });
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A time of day as minutes: "5am", "5:30pm", "0500", "05:00", "17" → 300, 1050, 300, 300, 1020; null when it isn't one.
 *  @param {string} v */
export const timeOf = (v) => {
	const m = /^(\d{1,4})(?::(\d{2}))?(am|pm)?$/.exec(v.trim().toLowerCase());
	const digits = m?.[1] ?? '';
	if (!m || (m[2] !== undefined && digits.length > 2)) return null;
	let h = m[2] !== undefined || digits.length <= 2 ? Number(digits) : Number(digits.slice(0, -2));
	const min = m[2] !== undefined ? Number(m[2]) : digits.length <= 2 ? 0 : Number(digits.slice(-2));
	if (m[3]) {
		if (h < 1 || h > 12) return null;
		h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
	}
	if (min > 59 || h * 60 + min > 24 * 60) return null;
	return h * 60 + min;
};

/** The start of a day (this computer's time): "today", "yesterday", "15nov", "nov15" or "2026-11-15"; a day and month
 *  later than today is last year's. Null when it isn't a day. @param {string} v @param {number} now */
export const dayOf = (v, now) => {
	const t = v.trim().toLowerCase(), today = new Date(now);
	today.setHours(0, 0, 0, 0);
	if (t === 'today') return today.getTime();
	if (t === 'yesterday') { today.setDate(today.getDate() - 1); return today.getTime(); }
	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
	const dm = /^(\d{1,2})([a-z]{3,})$/.exec(t), md = /^([a-z]{3,})(\d{1,2})$/.exec(t);
	const [y, mo, d] = iso ? [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])]
		: dm ? [undefined, MONTHS.indexOf((dm[2] ?? '').slice(0, 3)), Number(dm[1])]
			: md ? [undefined, MONTHS.indexOf((md[1] ?? '').slice(0, 3)), Number(md[2])] : [undefined, -1, 0];
	if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
	const day = new Date(y ?? today.getFullYear(), mo, d);
	if (day.getMonth() !== mo) return null;
	if (y === undefined && day > today) day.setFullYear(day.getFullYear() - 1);
	return day.getTime();
};

/**
 * What's typed in the search box: plain words (each must be in the map's title or difficulty) and tags,
 * like length>1m30, length<=90, skill:stamina, skill!=accuracy, stars>=5 or star-rating=4.5 (!= means not), and
 * when it was played: day=today, ts=5am, te=7pm. A tag that can't be read is a word.
 * @param {string} text
 * @param {number} [now]
 * @param {boolean} [timeTags] whether day, ts and te are read (Advanced mode); without, they're words
 * @returns {Search}
 */
export const parseSearch = (text, now = Date.now(), timeTags = true) => {
	/** @type {Search} */
	const out = { words: [], tags: [], time: null };
	for (const part of text.toLowerCase().split(/\s+/).filter(Boolean)) {
		const m = /^([a-z-]+)(!=|>=|<=|>|<|=|:)(.+)$/.exec(part);
		const [, name = '', op = '', raw = ''] = m || [];
		const timeKey = TIME_KEYS[name];
		if (timeTags && timeKey && (op === '=' || op === ':')) {
			const value = timeKey === 'day' ? dayOf(raw, now) : timeOf(raw);
			if (value !== null) { out.time = { ...out.time, [timeKey]: value }; continue; }
		}
		const key = TAG_KEYS[name];
		if (key) {
			const value = key === 'length' ? lengthOf(raw) : key === 'stars' ? (Number.isFinite(Number(raw)) ? Number(raw) : null) : raw;
			if (value !== null && value !== '') { out.tags.push({ key, op: op === ':' ? '=' : op, value }); continue; }
		}
		out.words.push(part);
	}
	return out;
};

/** Whether there's anything to search for. @param {Search} q */
export const searching = (q) => q.words.length > 0 || q.tags.length > 0 || q.time !== null;

/**
 * Whether a play's time fits the search's day, ts and te (this computer's time). With a day: from ts (or its start)
 * to te (or its end); a te not after ts runs into the next day. Without one: that time of day, on any day.
 * @param {Search} q @param {number} playedAt
 */
export const playedIn = (q, playedAt) => {
	const t = q.time;
	if (!t) return true;
	const from = t.ts ?? 0, to = t.te ?? 24 * 60, wraps = to <= from;
	if (t.day === undefined) {
		const d = new Date(playedAt), m = d.getHours() * 60 + d.getMinutes();
		return wraps ? m >= from || m < to : m >= from && m < to;
	}
	const at = (/** @type {number} */ days, /** @type {number} */ minutes) => { const d = new Date(/** @type {number} */ (t.day)); d.setDate(d.getDate() + days); d.setHours(0, minutes, 0, 0); return d.getTime(); };
	return playedAt >= at(0, from) && playedAt < at(wraps ? 1 : 0, to);
};

/** The (up to) 2 skills a play or map trained most, 15% of its XP or more (the biggest always). @param {Gains} gains */
export const topSkills = (gains) => {
	const total = totalOf(gains);
	if (!(total > 0)) return [];
	return SKILLS_7K.filter((sk) => num(gains[sk]) > 0).sort((a, b) => num(gains[b]) - num(gains[a]))
		.filter((sk, i) => i === 0 || num(gains[sk]) / total >= 0.15).slice(0, 2);
};

/** The skill a play or map gave the most XP to, or ''. @param {Gains} gains */
export const mainSkill = (gains) => topSkills(gains)[0] ?? '';

/** @param {number} a @param {string} op @param {number} b @param {number} step */
const compare = (a, op, b, step) => (op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b
	: op === '!=' ? !(a >= b && a < b + step) : a >= b && a < b + step);

/**
 * Whether a map (at a rate, with the XP it gave per skill) fits the search. Length is at that rate; a map the
 * catalogue doesn't know fits no length or star tag.
 * @param {Search} q @param {MapInfo | undefined} info @param {number} beatmapId @param {number} rate @param {Gains} gains
 */
export const fitsSearch = (q, info, beatmapId, rate, gains) => {
	const name = `${info ? `${info.title} ${info.difficulty}` : ''} ${beatmapId}`.toLowerCase();
	if (!q.words.every((w) => name.includes(w))) return false;
	for (const t of q.tags) {
		if (t.key === 'skill') {
			const want = String(t.value);
			// skill:stamina: one of the map's top 2 skills; skill!=accuracy: not the skill it gives the most XP to
			if (t.op === '!=' ? mainSkill(gains).startsWith(want) : !topSkills(gains).some((sk) => sk.startsWith(want))) return false;
		} else if (t.key === 'length') {
			if (!info || !(info.lengthSec > 0)) return false;
			// "=" means that whole second
			if (!compare(Math.round(info.lengthSec / (num(rate) || 1)), t.op, Number(t.value), 1)) return false;
		} else {
			if (!info || !(num(info.stars) > 0)) return false;
			// "=" with a whole number means that star (5 → 5.00 to 5.99), with a decimal that tenth
			const v = Number(t.value), step = Number.isInteger(v) ? 1 : 0.1;
			if (!compare(num(info.stars), t.op, v, step)) return false;
		}
	}
	return true;
};
