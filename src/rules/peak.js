// To Peak: where Peak is in strain minutes, how mindblock cuts XP, and which plays take you there.
// The bar and mindblock are the game's own formulas (oss!idle shared/fatigue.ts warmupBar, server/mindblock.ts),
// without the genes, which the game's API doesn't give. How much a map moves your strain comes from your own plays:
// the game can't simulate 7K, so the plan is a rough estimate.

/** A CSS-style cubic bezier easing (the game's math/cubic_bezier.ts). @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
const cubicBezier = (x0, y0, x1, y1) => {
	const cx = 3 * x0, bx = 3 * (x1 - x0) - cx, ax = 1 - cx - bx;
	const cy = 3 * y0, by = 3 * (y1 - y0) - cy, ay = 1 - cy - by;
	/** @param {number} r */
	const x = (r) => ((ax * r + bx) * r + cx) * r;
	/** @param {number} r */
	const y = (r) => ((ay * r + by) * r + cy) * r;
	/** @param {number} t */
	return (t) => {
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		// bisection: x(r) rises from 0 to 1 over [0, 1]
		let lo = 0, hi = 1, r = t;
		for (let i = 0; i < 64; i++) {
			const d = x(r) - t;
			if (Math.abs(d) < 1e-7) break;
			if (d > 0) hi = r; else lo = r;
			r = (lo + hi) / 2;
		}
		return y(r);
	};
};
/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;

const STRAIN_CAP = 7 * 60, ONSET_MINUTES = 5 * 60;
const WARM_MINUTES = 90, WARM_EARLY = 30, GEAR_LADDER = 10, GEAR_SPEED = 0.1, GEAR_HOLD = 3, GEAR_DECAY = 0.7;
const HALF_WARM_MINUTES = 5 * 60, COLD_MINUTES = 6 * 60, SWEET_SPOT = 0.9;
const FATIGUE_CB = cubicBezier(0.4, 0, 0.6, 1);

/** @param {number} m @param {number} from @param {number} to */
const ease = (m, from, to) => (to > from ? FATIGUE_CB((m - from) / (to - from)) : Number(m >= to));

/** The stamina upgrades warm-up counts with. @param {number} upgrades */
const warmGear = (upgrades) => {
	const tiers = Math.max(0, upgrades - GEAR_LADDER);
	return Math.min(upgrades, GEAR_LADDER) + (1 - GEAR_DECAY ** tiers) / (1 - GEAR_DECAY);
};

/** The strain minutes where warm-up peaks, starts cooling, is half and cold. @param {number} upgrades */
const warmupCurve = (upgrades) => {
	const gear = warmGear(upgrades), hold = gear * GEAR_HOLD;
	const cold = Math.min(COLD_MINUTES + hold, STRAIN_CAP), half = Math.min(HALF_WARM_MINUTES + hold, cold);
	const peakEnd = Math.min(WARM_MINUTES + hold, half);
	const warm = Math.min(WARM_MINUTES / (1 + gear * GEAR_SPEED) - WARM_EARLY, peakEnd);
	return { warm, peakEnd, half, cold };
};

/** How warmed up `m` strain minutes leave you, 0 cold to 1 warm. @param {number} m @param {number} upgrades */
const warmup = (m, upgrades) => {
	const { warm, peakEnd, half, cold } = warmupCurve(upgrades);
	if (m < warm) return ease(m, 0, warm);
	if (m < half) return lerp(1, 0.5, ease(m, peakEnd, half));
	return lerp(0.5, 0, ease(m, half, cold));
};

/** Where in [lo, hi] `turned` flips to true. @param {(m: number) => boolean} turned @param {number} lo @param {number} hi */
const crossing = (turned, lo, hi) => {
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (turned(mid)) hi = mid; else lo = mid;
	}
	return hi;
};

/** The strain minutes where the bar's zones start: [0, Peak, past Peak, Fatigued, the cap]. @param {number} upgrades */
const barKnots = (upgrades) => {
	const { warm, peakEnd, cold } = warmupCurve(upgrades);
	const sweetEnd = crossing((m) => warmup(m, upgrades) < SWEET_SPOT, peakEnd, cold);
	return [0, crossing((m) => warmup(m, upgrades) >= SWEET_SPOT, 0, warm), Math.min(sweetEnd, ONSET_MINUTES), ONSET_MINUTES, STRAIN_CAP];
};

/** Where `minutes` of strain sit on the bar, 0 to 1 (the game's warmupBar). @param {number} minutes @param {number} upgrades */
export const strainBar = (minutes, upgrades) => {
	const knots = barKnots(upgrades), at = [0, 0.4, 0.6, 0.8, 1];
	let i = 1;
	while (i < knots.length - 1 && minutes > (knots[i] ?? 0)) i++;
	const from = knots[i - 1] ?? 0, span = (knots[i] ?? 0) - from;
	const t = span > 0 ? (minutes - from) / span : 1;
	return lerp(at[i - 1] ?? 0, at[i] ?? 1, Math.min(1, Math.max(0, t)));
};

/** Peak in strain minutes: [where it starts, where it ends]. @param {number} upgrades @returns {[number, number]} */
export const peakMinutes = (upgrades) => {
	const [, start = 0, end = 0] = barKnots(upgrades);
	return [start, end];
};

const BLOCK_CB = cubicBezier(0.6, 0, 0.6, 1);
/** The share of the mindblock skills' XP a play keeps after `recent` plays of that map (in your last 50, within a day). @param {number} recent */
export const mindblockFactor = (recent) => lerp(1, 0.25, BLOCK_CB(Math.min(1, recent / 25)));

/** 7K skills mindblock doesn't cut: the physical ones tire instead, and Memory (the game's 7k/skills.ts). */
export const MINDBLOCK_FREE = ['speed', 'stamina', 'jacks', 'ln', 'memory'];

/**
 * @typedef {{ key: string, beatmapId: number, lengthMin: number, change: number, free: number, blocked: number, recent: number }} PeakMap
 *   `change`: strain minutes per minute of the map; `free` / `blocked`: XP per minute of the skills mindblock doesn't
 *   / does cut, as your plays gave them; `recent`: its plays in your last 50 within a day.
 * @typedef {{ key: string, count: number }} PeakStep
 * @typedef {{ steps: PeakStep[], plays: number, minutes: number, xp: number, reached: boolean }} PeakPlan
 */

/** How many plays a plan may take before it gives up. */
const MAX_PLAYS = 40;

/**
 * The plays that take `strain` minutes to `target`: each next play is the map that gives the most XP per minute
 * now (mindblock counted, so a map with mindblock skills drops back as you repeat it), among maps that move strain
 * the right way. Runs of the same map are grouped.
 * @param {number} strain @param {number} target @param {PeakMap[]} maps
 * @returns {PeakPlan}
 */
export const planToPeak = (strain, target, maps) => {
	const way = Math.sign(target - strain);
	const pool = maps.filter((m) => m.lengthMin > 0 && m.change * way > 0).map((m) => ({ ...m }));
	/** @type {PeakStep[]} */
	const steps = [];
	let now = strain, minutes = 0, xp = 0, plays = 0;
	const reached = () => (way > 0 ? now >= target : now <= target);
	while (way && pool.length && !reached() && plays < MAX_PLAYS) {
		/** @param {typeof pool[number]} m */
		const perMinute = (m) => m.free + m.blocked * mindblockFactor(m.recent);
		const best = pool.reduce((a, b) => (perMinute(b) > perMinute(a) ? b : a));
		xp += perMinute(best) * best.lengthMin;
		now = Math.max(0, now + best.change * best.lengthMin);
		minutes += best.lengthMin;
		best.recent++;
		plays++;
		const last = steps[steps.length - 1];
		if (last && last.key === best.key) last.count++;
		else steps.push({ key: best.key, count: 1 });
	}
	return { steps, plays, minutes, xp, reached: !way || reached() };
};
