// Strain: how a play moved your strain, as the strain minutes it added (or rested) per minute of the map.
// The game gives only the strain as it is now, so a play's is worked out when the play shows up.

/** A play adds up to this many strain minutes per minute of it (oss!idle shared/fatigue.ts STRAIN_RATE). */
const STRAIN_RATE = 3;
/** Smaller changes per minute than this count as no change: no arrows. */
const STILL = 0.05;
/** Up to this share of a map strained, a play rests you at the full minute a minute (fatigue.ts LIGHT_SHARE). */
const LIGHT_SHARE = 0.2;

/** The game's cubic-bezier easing (cubic_bezier.ts). @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
const cubicBezier = (x0, y0, x1, y1) => {
	const ax = 1.0 - (x1 = 3.0 * (x1 - x0) - (x0 *= 3.0)) - x0;
	const ay = 1.0 - (y1 = 3.0 * (y1 - y0) - (y0 *= 3.0)) - y0;
	/** @param {number} t */
	return (t) => {
		let i, r, s, d, x;
		if (t < 0) return 0;
		if (t > 1) return 1;
		for (r = t, i = 0; i < 32; i++) {
			if (Math.abs((x = r * (r * (r * ax + x1) + x0) - t)) < 1e-5) return r * (r * (r * ay + y1) + y0);
			if (Math.abs((d = r * (r * ax * 3.0 + x1 * 2.0) + x0)) < 1e-5) break;
			r -= x / d;
		}
		if ((s = 0.0) > (r = t)) return 0;
		if ((d = 1.0) < r) return 1;
		for (i = 0; d > s && i < 64; i++) {
			if (Math.abs((x = r * (r * (r * ax + x1) + x0)) - t) < 1e-5) break;
			if (t > x) s = r; else d = r;
			r = 0.5 * (d - s) + s;
		}
		return r * (r * (r * ay + y1) + y0);
	};
};
const FATIGUE_CB = cubicBezier(0.4, 0, 0.6, 1);

/**
 * Strain minutes gained (above 0) or rested (below 0) per minute of the map.
 * @param {number} before @param {number} after @param {number} lengthMin
 */
export const strainPerMinute = (before, after, lengthMin) => (lengthMin > 0 ? (after - before) / lengthMin : 0);

/**
 * The strain left after resting `restMin` minutes: a minute of rest takes off a minute of strain, down to 0
 * (fatigue.ts restedFatigue, without the rest-speed gene).
 * @param {number} minutes @param {number} restMin
 */
export const restedStrain = (minutes, restMin) => Math.max(0, minutes - Math.max(0, restMin));

/**
 * -3 to 3: the game's arrows for a play, from how many of its minutes strained you (fatigue.ts warmupTrend).
 * @param {number} lengthMin @param {number} strainedMin
 */
export const trendOf = (lengthMin, strainedMin) => {
	if (!(lengthMin > 0)) return 0;
	const drift = -1 + (STRAIN_RATE + 1) * FATIGUE_CB((strainedMin / lengthMin - LIGHT_SHARE) / (1 - LIGHT_SHARE));
	return drift >= 0 ? Math.ceil(Math.min(1, drift / STRAIN_RATE) * 3) : -Math.ceil(Math.min(1, -drift) * 3);
};

/**
 * -3 to 3: the game's arrows for a change per minute, › warming, ‹ cooling (a play rests at most 1 minute a
 * minute); 0 for no real change.
 * @param {number} perMinute
 */
export const arrowsOf = (perMinute) => {
	if (!(Math.abs(perMinute) >= STILL)) return 0;
	return perMinute > 0 ? Math.ceil(Math.min(1, perMinute / STRAIN_RATE) * 3) : -Math.ceil(Math.min(1, -perMinute) * 3);
};
