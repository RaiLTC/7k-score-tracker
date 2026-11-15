// Strain: how a play moved your strain, as the strain minutes it added (or rested) per minute of the map.
// The game gives only the strain as it is now, so a play's is worked out when the play shows up.

/** A play adds up to this many strain minutes per minute of it (oss!idle shared/fatigue.ts STRAIN_RATE). */
const STRAIN_RATE = 3;
/** Smaller changes per minute than this count as no change: no arrows. */
const STILL = 0.05;

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
 * -3 to 3: the game's arrows for a change per minute, › warming, ‹ cooling (a play rests at most 1 minute a
 * minute); 0 for no real change.
 * @param {number} perMinute
 */
export const arrowsOf = (perMinute) => {
	if (!(Math.abs(perMinute) >= STILL)) return 0;
	return perMinute > 0 ? Math.ceil(Math.min(1, perMinute / STRAIN_RATE) * 3) : -Math.ceil(Math.min(1, -perMinute) * 3);
};
